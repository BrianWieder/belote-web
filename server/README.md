# Belote Signaling Server

Lightweight signaling server for WebRTC peer connection establishment. Handles room management, relays ICE/SDP signaling data between players, and serves STUN/TURN ICE server configuration. Contains no game logic.

## Development

```bash
npm run dev        # Start with hot reload (tsx watch) on port 3001
npm start          # Start without watch
npm run typecheck  # TypeScript check without emitting
npm run build      # Compile TypeScript to dist/
npm test           # Run server unit tests
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `CLIENT_URL` | `http://localhost:5173` | CORS allowed origin(s); supports a comma-separated list (e.g. `https://a.com,https://b.com`) |
| `METERED_DOMAIN` | -- | Metered TURN domain (e.g. `myapp.metered.live`) for retrieving TURN credentials via Metered's REST API |
| `METERED_APP_NAME` | -- | Alternative to `METERED_DOMAIN` (app name such as `myapp`, automatically expanded to `myapp.metered.live`) |
| `METERED_API_KEY` | -- | Credential-scoped Metered API key paired with `METERED_DOMAIN` or `METERED_APP_NAME` (credential expiry/rotation is configured separately in Metered) |
| `TURN_USERNAME` | -- | Static Metered TURN username (used if `METERED_DOMAIN`/`METERED_APP_NAME` + `METERED_API_KEY` are not configured or unavailable) |
| `TURN_CREDENTIAL` | -- | Static Metered TURN credential paired with `TURN_USERNAME` |

## API

### Health Check

`GET /health` -- Returns `200` with `{ "status": "ok" }` if the server is running.

### ICE / TURN Servers

`GET /ice-servers` -- Returns `{ "iceServers": RTCIceServer[] }` with `Cache-Control: no-store`.

- Always includes default public STUN servers (`stun:stun.l.google.com:19302`, `stun:global.stun.twilio.com:3478`, `stun:stun.relay.metered.ca:80`).
- If `METERED_DOMAIN` (or `METERED_APP_NAME`) and a credential-scoped `METERED_API_KEY` are set, retrieves the configured TURN credential from Metered's REST API and caches the response in memory for 5 minutes (credential expiry and rotation are managed separately via Metered's credential configuration).
- Otherwise (or if Metered is unreachable), falls back to static Metered TURN entries when `TURN_USERNAME` and `TURN_CREDENTIAL` are set, or STUN-only if neither is configured.

### Socket.io Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `create-room` | Client -> Server | -- | Cleans up any prior room for this socket, creates a room, returns `{ code, reconnectToken }` or `{ error }` if at capacity |
| `join-room` | Client -> Server | `code: string` or `{ code, attemptId? }` | Validates code format and provisionally joins a room (rejects self-join; idempotent for same guest socket), returns `{ success, error?, reconnectToken? }` |
| `confirm-join` | Client -> Server | `code: string` | Confirms a provisional guest seat after receiving the `join-room` acknowledgement so disconnects preserve the room for the 2-minute grace window |
| `cancel-join` | Client -> Server | `code: string` or `{ code, attemptId? }` | Releases a matching provisional guest join after a client-side join timeout so the room returns to open lobby state |
| `rejoin-room` | Client -> Server | `{ code, role, token, passive?, retry? }` | Rejoins an active room within the 2-minute disconnect grace window. Acknowledges with `{ success, error?, role?, peerPresent?, alreadyNegotiating?, negotiationId? }`. Pass `passive: true` to restore a signaling seat while the data channel is still open without triggering renegotiation, and `retry: true` when retrying after a missed acknowledgement. Clients check `peerPresent`, `alreadyNegotiating`, and `negotiationId` before creating a WebRTC peer: if `!peerPresent`, wait for `peer-reconnected`; if `peerPresent` and `!alreadyNegotiating` (or if `negotiationId` has not yet been initialized locally), start a fresh peer for `role`; if already initialized for that `negotiationId`, keep the in-progress negotiation |
| `peer-connected` | Client -> Server | `code: string` | Marks the active renegotiation complete once the WebRTC data channel opens so a later drop on the same socket pair starts a fresh negotiation |
| `leave-room` | Client -> Server | -- | Explicitly leaves and closes the room |
| `peer-joined` | Server -> Host | `{ socketId }` | Notifies the host that a guest has joined |
| `peer-join-cancelled` | Server -> Host | -- | Notifies the host that a timed-out or disconnected provisional guest join was released |
| `peer-reconnected` | Server -> Peer | `{ role, negotiationId? }` | Notifies the waiting peer to negotiate a fresh WebRTC connection for `negotiationId` |
| `signal` | Client -> Server | `{ roomCode, signal }` | Validates payload and relays WebRTC signaling data to the other peer in the room |
| `signal` | Server -> Client | `{ signal, from }` | Forwarded signaling data from the other peer |
| `peer-disconnected` | Server -> Peer | `{ preserved }` | Notifies the remaining peer when a player disconnects (`preserved: true`) or explicitly leaves (`preserved: false`) |

## Structure

```
src/
├── index.ts       # Express + Socket.io server setup, CORS, /health, /ice-servers, graceful shutdown
├── signaling.ts   # Socket.io event handlers with input validation
├── rooms.ts       # Room CRUD, room cap, code generation, auto-cleanup (1 hour TTL)
├── iceServers.ts  # STUN/TURN configuration and Metered credential fetching + cache
└── __tests__/     # Unit tests (rooms, iceServers, signaling)
```

Room codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, L, 1 to avoid ambiguity).

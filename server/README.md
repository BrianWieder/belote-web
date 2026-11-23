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
| `create-room` | Client -> Server | -- | Cleans up any prior room for this socket, creates a room, returns `{ code: string }` (4-char alphanumeric) or `{ error: string }` if at capacity |
| `join-room` | Client -> Server | `code: string` | Validates code format and joins a room (rejects self-join), returns `{ success: boolean, error?: string }` |
| `peer-joined` | Server -> Host | `{ socketId }` | Notifies the host that a guest has joined |
| `signal` | Client -> Server | `{ roomCode, signal }` | Validates payload and relays WebRTC signaling data to the other peer in the room |
| `signal` | Server -> Client | `{ signal, from }` | Forwarded signaling data from the other peer |
| `peer-disconnected` | Server -> Room | -- | Notifies the remaining peer when a player disconnects or leaves |

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

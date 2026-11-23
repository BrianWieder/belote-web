# Belote Maniee

A two-player Belote card game with real-time peer-to-peer gameplay. Players connect via a signaling server and play directly over WebRTC data channels.

## Project Structure

```
belote/
├── client/          # React frontend (Vite + TypeScript + Tailwind)
│   ├── src/
│   │   ├── game/        # Game engine (deterministic, runs on both clients)
│   │   ├── networking/  # WebRTC peer connection + Socket.io signaling
│   │   ├── components/  # React UI components
│   │   ├── hooks/       # React hooks (useGame, usePeer)
│   │   └── store/       # Zustand state management
│   └── e2e/             # Playwright E2E tests
├── server/          # Signaling server (Express + Socket.io)
│   └── src/
│       ├── index.ts      # HTTP server entry point (/health, /ice-servers)
│       ├── signaling.ts  # Socket.io event handlers
│       ├── rooms.ts      # Room management
│       └── iceServers.ts # STUN/TURN ICE server configuration
└── package.json     # npm workspaces root
```

## Quick Start

```bash
# Install dependencies
npm install

# Start the signaling server (port 3001)
cd server && npm run dev &

# Start the client dev server (port 5173)
cd client && npm run dev
```

Open two browser tabs to `http://localhost:5173`. One player creates a room, the other joins with the 4-character code.

## How It Works

1. **Lobby** -- Host creates a room via the signaling server. Guest joins with the room code.
2. **WebRTC Handshake** -- The signaling server relays ICE candidates and SDP offers/answers between peers via Socket.io.
3. **Game Sync** -- The host generates a random seed and sends it to the guest. Both clients run the same deterministic game engine with the same seed, so cards are dealt identically.
4. **Gameplay** -- Actions (bids, card plays) are applied locally and sent to the other player over the WebRTC data channel. No game state passes through the server after the initial handshake.
5. **Scoring** -- First player to 1000 points wins. Rounds are scored with trick points, last trick bonus, belote bonus, and dedans (failed contract) penalties.

## Game Rules

Belote Maniee is a two-player French trick-taking card game using a 32-card deck (7 through Ace in each suit).

- **Dealing**: 5 cards each, plus a face-up trump proposal card. After the bid is taken, each player is dealt up to 8 cards and a 4-slot tableau (face-down card with a face-up card on top).
- **Bidding Round 1**: Players can "Take" (accept the face-up card's suit as trump) or "Pass". If the face-up card is a Jack, the non-dealer is forced to take.
- **Bidding Round 2**: If both pass, players can choose a different suit as trump or pass again. If all pass again, the non-dealer is forced to take and picks any suit.
- **Playing**: 16 tricks. Must follow suit; must trump if unable to follow; must overtrump if possible.
- **Trump card values**: J=20, 9=14, A=11, 10=10, K=4, Q=3
- **Non-trump values**: A=11, 10=10, K=4, Q=3, J=2
- **Belote**: Playing both King and Queen of trump (belote/rebelote) scores 20 bonus points, provided both are visible (in hand or face-up on the tableau) when the first is played and you win at least one trick
- **Dedans**: If the taker's total points (including bonuses) are less than or equal to the opponent's, the opponent receives all 162 points (including the 10-point last-trick bonus); only Belote/Rebelote (20 points) stays with the player who declared it

## Environment Variables

### Server (`server/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Signaling server listen port |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin(s); supports comma-separated origins (e.g. `https://a.com,https://b.com`) |
| `METERED_DOMAIN` | -- | Metered TURN domain (e.g. `myapp.metered.live`) for retrieving TURN credentials via `GET /ice-servers` |
| `METERED_APP_NAME` | -- | Alternative to `METERED_DOMAIN` (bare app name expanded to `<name>.metered.live`) |
| `METERED_API_KEY` | -- | Credential-scoped Metered API key paired with `METERED_DOMAIN` or `METERED_APP_NAME` (credential expiry/rotation is configured separately in Metered) |
| `TURN_USERNAME` | -- | Static Metered TURN username (fallback when Metered API vars are not configured) |
| `TURN_CREDENTIAL` | -- | Static Metered TURN credential paired with `TURN_USERNAME` |

### Client (`client/`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_SERVER_URL` | `http://localhost:3001` | Signaling server URL (used for Socket.io and `GET /ice-servers`) |

> Legacy `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` client env vars remain supported as a backwards-compatible fallback if the server only returns STUN servers, but TURN credentials should be configured on the server instead.

## Testing

```bash
# Client unit tests (game engine & networking)
(cd client && npx vitest run)

# Server unit tests
(cd server && npm test)

# E2E tests (full two-player game via Playwright)
(cd client && npx playwright test)
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand, Framer Motion
- **Networking**: Native WebRTC (`RTCPeerConnection` / `RTCDataChannel`), Socket.io
- **Server**: Express, Socket.io
- **Testing**: Vitest (unit), Playwright (E2E)

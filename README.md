# Belote Maniee

A two-player Belote card game with real-time peer-to-peer multiplayer and a solo AI bot mode. Online players connect via a lightweight signaling server and play directly over WebRTC data channels.

## Project Structure

```
belote/
├── client/          # React frontend (Vite + TypeScript + Tailwind)
│   ├── src/
│   │   ├── game/        # Deterministic game engine, heuristic bot, and reactions
│   │   ├── networking/  # WebRTC peer connection, Socket.io signaling, invite links
│   │   ├── components/  # React UI components (table, lobby, modals, reactions)
│   │   ├── hooks/       # React hooks (useGame, usePeer, useBotPlayer, feedback, shortcuts)
│   │   ├── store/       # Zustand state management & localStorage persistence
│   │   ├── audio/       # Synthesized Web Audio sound effects
│   │   └── telemetry.ts # Optional lazy-loaded Sentry telemetry
│   └── e2e/             # Playwright E2E tests (P2P, bot, UI features, reconnection)
├── server/          # Signaling server (Express + Socket.io)
│   └── src/
│       ├── index.ts      # HTTP server entry point (/health, /ice-servers)
│       ├── signaling.ts  # Socket.io event handlers
│       ├── rooms.ts      # Room management & reconnect grace window
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

Open `http://localhost:5173`. You can play **solo vs. the AI bot** (Casual or Smart difficulty) immediately, or open a second browser tab so one player creates a room and the other joins with the 4-character code or shareable invite link (`?join=CODE`).

## How It Works

1. **Lobby** -- Choose table options (target score `500` / `1000` / `1500`, optional Capot, display name) and either start a solo match against the AI bot, create a room (with a shareable `?join=CODE` invite link), resume a saved host match from `localStorage`, or join a room by code.
2. **WebRTC Handshake** -- The signaling server relays ICE candidates and SDP offers/answers between peers via Socket.io and provides STUN/TURN config via `GET /ice-servers`.
3. **Game Sync** -- The host generates a random seed and sends it (along with match options) to the guest. Both clients run the same deterministic game engine with the same seed, so cards are dealt identically.
4. **Gameplay** -- Actions (bids, card plays, bistrot reactions, round-ready / rematch checks) are applied locally and sent over the WebRTC data channel. No game state passes through the server after the initial handshake, and dropped connections can recover in place within the 2-minute signaling grace window.
5. **Scoring** -- First player to the configured target score (`500`, `1000`, or `1500`; default `1000`) wins. Rounds are scored with trick points, last trick bonus, belote bonus, dedans penalties, and optional capot scoring.

## Game Rules

Belote Maniee is a two-player French trick-taking card game using a 32-card deck (7 through Ace in each suit).

- **Dealing**: 5 cards each, plus a face-up trump proposal card. After the bid is taken, each player is dealt up to 8 cards and a 4-slot tableau (face-down card with a face-up card on top).
- **Bidding Round 1**: Players can "Take" (accept the face-up card's suit as trump) or "Pass". If the face-up card is a Jack, the non-dealer is forced to take.
- **Bidding Round 2**: If both pass, players can choose a different suit as trump or pass again. If all pass again, the non-dealer is dealt the turned-up card plus 2 cards from the deck (seeing their full 8-card hand) and is forced to pick any suit as trump.
- **Playing**: 16 tricks. Must follow suit; must trump if unable to follow; must overtrump if possible.
- **Trump card values**: J=20, 9=14, A=11, 10=10, K=4, Q=3
- **Non-trump values**: A=11, 10=10, K=4, Q=3, J=2
- **Belote**: Playing both King and Queen of trump (belote/rebelote) scores 20 bonus points, provided both are visible (in hand or face-up on the tableau) when the first is played and you win at least one trick
- **Dedans**: If the taker's total points (including bonuses) are less than or equal to the opponent's, the opponent receives all 162 points (including the 10-point last-trick bonus); only Belote/Rebelote (20 points) stays with the player who declared it
- **Capot (optional)**: When enabled in table options, winning all 16 tricks awards 252 points (152 card points + 100 capot bonus replacing the 10-point last-trick bonus), plus 20 points if the capot winner declared Belote/Rebelote

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
| `VITE_SERVER_URL` | `http://localhost:3001` | Signaling server URL (used for Socket.io and `GET /ice-servers`); accepts scheme-less hostnames (defaults to `https://` for non-loopback hosts and rejects cleartext `http://` outside localhost) |
| `VITE_SENTRY_DSN` | -- | Optional Sentry DSN for lazy-loaded runtime error and performance monitoring |
| `SENTRY_AUTH_TOKEN` | -- | Optional build-time Sentry auth token for emitting and uploading hidden source maps |
| `SENTRY_ORG` | -- | Optional Sentry organization slug paired with `SENTRY_AUTH_TOKEN` |
| `SENTRY_PROJECT` | -- | Optional Sentry project slug paired with `SENTRY_AUTH_TOKEN` |

> Legacy `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` client env vars remain supported as a backwards-compatible fallback if the server only returns STUN servers, but TURN credentials should be configured on the server instead.

## Testing

```bash
# Client unit tests (game engine, bot, networking, store, components, hooks, audio)
(cd client && npm test)

# Client unit tests with V8 coverage
(cd client && npm run test:coverage)

# Server unit tests
(cd server && npm test)

# E2E tests (P2P gameplay, solo bot, UI features, and live WebRTC reconnection)
(cd client && npx playwright test)
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand, Framer Motion, Sentry (optional)
- **Networking**: Native WebRTC (`RTCPeerConnection` / `RTCDataChannel`), Socket.io
- **Server**: Express, Socket.io
- **Testing**: Vitest + React Testing Library + jsdom (unit), Node test runner via `tsx` (server), Playwright (E2E)

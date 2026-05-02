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
│       ├── index.ts     # HTTP server entry point
│       ├── signaling.ts # Socket.io event handlers
│       └── rooms.ts     # Room management
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

- **Dealing**: 5 cards each, plus a face-up trump proposal card
- **Bidding Round 1**: Players can "Take" (accept the face-up card's suit as trump) or "Pass"
- **Bidding Round 2**: If both pass, players can choose a different suit as trump or pass again. If all pass again, cards are redealt.
- **Playing**: 8 tricks. Must follow suit; must trump if unable to follow; must overtrump if possible.
- **Trump card values**: J=20, 9=14, A=11, 10=10, K=4, Q=3
- **Non-trump values**: A=11, 10=10, K=4, Q=3, J=2
- **Belote**: Declaring King + Queen of trump scores 20 bonus points
- **Dedans**: If the taker scores fewer trick points than the opponent, all 162 points go to the opponent

## Testing

```bash
# Unit tests (game engine)
cd client && npx vitest

# E2E tests (full two-player game via Playwright)
cd client && npx playwright test
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand, Framer Motion
- **Networking**: simple-peer (WebRTC), Socket.io
- **Server**: Express, Socket.io
- **Testing**: Vitest (unit), Playwright (E2E)

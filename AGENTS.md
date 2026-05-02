# CLAUDE.md

## Build & Run Commands

```bash
# Install all dependencies (npm workspaces)
npm install

# Client dev server (port 5173)
cd client && npm run dev

# Server dev server (port 3001)
cd server && npm run dev

# Run unit tests
cd client && npx vitest

# Run a single unit test file
cd client && npx vitest src/game/__tests__/engine.test.ts

# Run E2E tests (starts both servers automatically)
cd client && npx playwright test

# Lint
cd client && npm run lint

# Build client
cd client && npm run build
```

## Architecture

This is a two-player Belote card game using **deterministic game state** -- both clients run the same game engine with a shared seed, so they always compute the same state independently.

### Key Design Decisions

- **No server-side game logic.** The server only handles room creation and WebRTC signaling. All game state is computed client-side.
- **Deterministic engine.** `createInitialState(seed, dealer)` produces identical state on both clients. Actions are applied via `applyAction()` which is a pure function.
- **P2P messaging.** After the WebRTC handshake, all game messages go directly between browsers. The server can go down and an in-progress game continues.
- **Module-level peer state.** The peer connection is managed in `client/src/networking/peer.ts` as module-level variables (not React state). The `usePeer` hook in `App.tsx` sets up handlers and cleanup.

### Data Flow

```
User Action → useGame hook → gameStore.performAction()
  → applyAction() (local state update)
  → sendPeerMessage() (send to opponent via WebRTC)

Received Message → peer.on('data') → messageHandler
  → gameStore.receiveAction() → applyAction() (update state)
```

### Important Files

| File | Purpose |
|------|---------|
| `client/src/game/engine.ts` | Core game engine: dealing, bidding, playing, round scoring |
| `client/src/game/types.ts` | All game types: GameState, Card, Suit, Rank, GameAction, Phase |
| `client/src/game/scoring.ts` | Card values, trick winner determination, round score calculation |
| `client/src/game/validation.ts` | Legal move validation (follow suit, must trump, overtrump) |
| `client/src/game/deck.ts` | Deck creation and seeded shuffle |
| `client/src/store/gameStore.ts` | Zustand store: connection state + game state + actions |
| `client/src/networking/peer.ts` | WebRTC peer connection management (simple-peer wrapper) |
| `client/src/networking/signaling.ts` | Socket.io client for room creation/joining |
| `client/src/hooks/usePeer.ts` | React hook for peer lifecycle (called in App.tsx, not Lobby) |
| `client/src/hooks/useGame.ts` | React hook exposing game actions to components |
| `server/src/signaling.ts` | Socket.io event handlers (create-room, join-room, signal relay) |
| `server/src/rooms.ts` | Room CRUD with auto-cleanup |

### Game Phases

`bidding-round1` → `bidding-round2` (if both pass) → `playing` → `round-over` → (next round or `game-over`)

### Component Structure

```
App (usePeer lives here)
├── Lobby (room creation/joining UI)
└── GameBoard (shown when gameState exists)
    ├── Scoreboard (top bar, game score to 1000)
    ├── OpponentHand (face-down cards)
    ├── BiddingUI (take/pass/choose suit) OR PlayArea (current trick)
    ├── Hand (player's cards, clickable when playable)
    ├── RoundSummary (modal after each round)
    └── GameOver (modal when someone reaches 1000)
```

## Gotchas

- **`usePeer` must be in App.tsx**, not Lobby. If it's in Lobby, the peer connection is destroyed when Lobby unmounts (on game start), breaking guest→host communication.
- **`simple-peer`'s `.connected` property is unreliable** under Vite 8's polyfill environment. The codebase tracks connection state with a local `peerConnected` boolean instead.
- **Vite 8 requires `vite-plugin-node-polyfills`** for `simple-peer` to work (it depends on Node.js builtins like `events`, `buffer`, `readable-stream`). The `define: { global: 'globalThis' }` is also needed.
- **React StrictMode** double-mounts components in dev. Effects with cleanup that destroy global resources (like peer connections) must account for this.

## Code Style

- TypeScript strict mode
- Functional React components with hooks
- Tailwind CSS for styling (no CSS modules or styled-components)
- Zustand for state management (single store)
- No router -- App.tsx conditionally renders Lobby or GameBoard based on gameState

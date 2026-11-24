# AGENTS.md

## Build & Run Commands

```bash
# Install all dependencies (npm workspaces)
npm install

# Client dev server (port 5173)
cd client && npm run dev

# Server dev server (port 3001)
cd server && npm run dev

# Run client unit tests (single run / watch)
cd client && npm test
cd client && npx vitest

# Run a single client unit test file
cd client && npx vitest run src/game/__tests__/engine.test.ts

# Run client unit tests with coverage
cd client && npm run test:coverage

# Run server unit tests & typecheck
cd server && npm test
cd server && npm run typecheck

# Run E2E tests (starts both servers automatically)
cd client && npx playwright test

# Lint client
cd client && npm run lint

# Build client
cd client && npm run build
```

## Architecture

This is a two-player Belote card game supporting **real-time P2P multiplayer** and **solo play vs. an AI bot**. Multiplayer uses **deterministic game state** -- both clients run the same game engine with a shared seed and match options, so they always compute the same state independently.

### Key Design Decisions

- **No server-side game logic.** The server only handles room creation, WebRTC signaling, and STUN/TURN ICE server configuration (`GET /ice-servers`). All game state is computed client-side.
- **Deterministic engine.** `createInitialState(seed, dealer, options?)` produces identical state on both clients. Actions are applied via `applyAction()` which is a pure function.
- **P2P messaging.** After the WebRTC handshake, all game messages go directly between browsers over `RTCDataChannel`. The server can go down and an in-progress game continues.
- **Solo bot mode.** Runs entirely client-side (`gameMode: 'bot'`) with `Casual` and `Smart` heuristic difficulties driven by `useBotPlayer` without opening signaling or WebRTC connections.
- **Module-level peer state.** The peer connection is managed in `client/src/networking/peer.ts` as module-level variables (not React state). The `usePeer` hook in `App.tsx` sets up handlers and cleanup.

### Data Flow

```
P2P Local Action → useGame hook → gameStore.performAction()
  → applyAction() (local state update)
  → sendPeerMessage() (send to opponent via RTCDataChannel)

P2P Received Message → dataChannel.onmessage → onPeerMessage handler (usePeer)
  → gameStore.receiveAction() → applyAction() (update state)

Solo Bot Action → useBotPlayer hook → chooseBotAction()
  → gameStore.performBotAction() → applyAction() (local state update)
```

### Important Files

| File | Purpose |
|------|---------|
| `client/src/game/engine.ts` | Core game engine: dealing, bidding, playing, round scoring |
| `client/src/game/types.ts` | All game types: GameState, Card, Suit, Rank, GameAction, Phase, MatchOptions |
| `client/src/game/scoring.ts` | Card values, trick winner determination, round score calculation (incl. dedans & capot) |
| `client/src/game/validation.ts` | Legal move validation (follow suit, must trump, overtrump) |
| `client/src/game/deck.ts` | Deck creation and seeded shuffle |
| `client/src/game/bot.ts` | Heuristic AI bot (Casual & Smart difficulties) |
| `client/src/game/reactions.ts` | Bistrot table reaction definitions & cooldown constants |
| `client/src/store/gameStore.ts` | Zustand store: connection state, game state, preferences, social & match actions |
| `client/src/store/savedGame.ts` | Host match `localStorage` persistence, validation, and resume helpers |
| `client/src/store/playerName.ts` | Local player display name sanitization & persistence |
| `client/src/store/preferences.ts` | UI preference persistence (2-tap card confirmation) |
| `client/src/networking/peer.ts` | Native WebRTC `RTCPeerConnection` + `RTCDataChannel` manager & ICE server fetching |
| `client/src/networking/signaling.ts` | Socket.io client for room creation, joining, and reconnection |
| `client/src/networking/inviteLink.ts` | Shareable `?join=CODE` invite URL parsing & generation |
| `client/src/hooks/usePeer.ts` | React hook for peer lifecycle & reconnection (called in App.tsx, not Lobby) |
| `client/src/hooks/useBotPlayer.ts` | React hook driving solo AI bot turns (called in App.tsx) |
| `client/src/hooks/useGame.ts` | React hook exposing game actions and playable cards to components |
| `client/src/hooks/useGameFeedback.ts` | Synthesized sound effects and browser tab turn notifications |
| `client/src/hooks/useKeyboardShortcuts.ts` | Keyboard shortcuts for bidding and clearing 2-tap card selection |
| `client/src/audio/sounds.ts` | Web Audio API synthesized card/table sound effects & mute state |
| `client/src/telemetry.ts` | Lazy-loaded Sentry error/performance telemetry |
| `server/src/index.ts` | Express + Socket.io entry point (`/health`, `/ice-servers`, CORS, graceful shutdown) |
| `server/src/signaling.ts` | Socket.io event handlers (create-room, join-room, confirm-join, rejoin-room, signal relay) |
| `server/src/rooms.ts` | Room CRUD with 2-minute reconnect grace window & 1-hour auto-cleanup |
| `server/src/iceServers.ts` | STUN/TURN configuration and Metered REST credential fetching + cache |

### Game Phases

`bidding-round1` → `bidding-round2` (if both pass) → `bidding-forced` (if both pass again) → `playing` → `round-over` → (next round or `game-over`)

### Component Structure

```
ErrorBoundary (main.tsx)
└── App (usePeer & useBotPlayer live here)
    ├── Lobby (room creation/joining, invite links, match options, host resume, solo bot)
    └── GameBoard (shown when gameState exists)
        ├── Scoreboard (top bar, configurable target score 500/1000/1500, 2-tap & mute toggles)
        │   ├── RulesModal (rules cheat sheet)
        │   └── ScoreLedgerModal (round-by-round score history)
        ├── TableReactions (P2P bistrot reaction picker & pills)
        ├── OpponentHand (face-down cards)
        ├── Tableau (opponent & local player 4-slot tableaus during playing)
        ├── BiddingUI (take/pass/choose suit) OR PlayArea (current trick & last-trick peek)
        ├── Hand (player's cards, clickable / 2-tap confirmable when playable)
        ├── TrumpAnnouncement (overlay announcing trump suit after bidding)
        ├── RoundSummary (modal after each round, mutual ready check in P2P)
        └── GameOver (modal when target score is reached, live P2P rematch)
```

## Gotchas

- **`usePeer` must be in App.tsx**, not Lobby. If it's in Lobby, the peer connection is destroyed when Lobby unmounts (on game start), breaking guest→host communication.
- **Generation guards in `peer.ts`.** Every `RTCPeerConnection` / `RTCDataChannel` callback and async signaling step is guarded by a monotonic `generation` counter so torn-down or replaced connections cannot clobber a newer peer during reconnects or StrictMode remounts.
- **React StrictMode** double-mounts components in dev. Effects with cleanup that destroy global resources (like peer connections) must account for this.

## Code Style

- TypeScript strict mode
- Functional React components with hooks
- Tailwind CSS for styling (no CSS modules or styled-components)
- Zustand for state management (single store)
- No router -- App.tsx conditionally renders Lobby or GameBoard based on gameState

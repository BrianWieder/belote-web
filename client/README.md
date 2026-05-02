# Belote Client

React frontend for the Belote Maniee card game.

## Development

```bash
npm run dev      # Start Vite dev server on port 5173
npm run build    # Type-check and build for production
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

The signaling server must be running on port 3001 for multiplayer to work (see `../server/`).

## Testing

```bash
# Unit tests (game engine logic)
npx vitest

# E2E tests (full two-player game with Playwright)
# Automatically starts both client and server
npx playwright test
```

## Structure

```
src/
├── game/            # Deterministic game engine (no React dependencies)
│   ├── types.ts         # Card, GameState, GameAction, Phase types
│   ├── engine.ts        # State machine: dealing, bidding, playing, scoring
│   ├── scoring.ts       # Card values, trick winner, round score calculation
│   ├── validation.ts    # Legal move rules (follow suit, trump, overtrump)
│   ├── deck.ts          # 32-card deck creation and seeded shuffle
│   └── __tests__/       # Unit tests for engine, scoring, deck
├── networking/      # P2P connection layer
│   ├── peer.ts          # WebRTC data channel (simple-peer wrapper)
│   └── signaling.ts     # Socket.io client for room management
├── components/      # React UI
│   ├── Lobby.tsx        # Room creation and joining
│   ├── GameBoard.tsx    # Main game layout
│   ├── BiddingUI.tsx    # Bidding phase UI (take/pass/choose suit)
│   ├── Hand.tsx         # Player's hand (playable cards highlighted)
│   ├── Card.tsx         # Card rendering + suit button
│   ├── PlayArea.tsx     # Current trick display
│   ├── OpponentHand.tsx # Face-down opponent cards
│   └── Scoreboard.tsx   # Score bar, round summary modal, game over modal
├── hooks/
│   ├── usePeer.ts       # Peer connection lifecycle (used in App.tsx)
│   └── useGame.ts       # Game actions interface for components
├── store/
│   └── gameStore.ts     # Zustand store (connection + game state)
└── App.tsx              # Root component, switches between Lobby and GameBoard
```

## E2E Tests

The E2E test (`e2e/game.spec.ts`) uses two Playwright browser contexts to simulate two players. It:

1. Creates a room (host)
2. Joins with the room code (guest)
3. Completes bidding (first player takes)
4. Plays all 8 tricks
5. Verifies the round summary appears on both sides

Key `data-testid` attributes used by tests:
- Lobby: `create-room`, `room-code`, `join-code-input`, `join-room`
- Bidding: `your-turn-to-bid`, `bid-take`, `bid-pass`, `bid-suit-{suit}`, `waiting-for-opponent`
- Cards: `card-{rank}-{suit}` with `data-playable` attribute for clickable cards
- Game: `game-board`, `play-area`, `trick-counter`, `scoreboard`
- Round end: `round-summary`, `round-summary-title`, `next-round`

# Belote Signaling Server

Lightweight signaling server for WebRTC peer connection establishment. Handles room management and relays ICE/SDP signaling data between players. Contains no game logic.

## Development

```bash
npm run dev    # Start with hot reload (tsx watch) on port 3001
npm start      # Start without watch
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `CLIENT_URL` | `http://localhost:5173` | CORS allowed origin |

## API

### Health Check

`GET /health` -- Returns 200 if server is running.

### Socket.io Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `create-room` | Client -> Server | -- | Creates a room, returns `{ code: string }` (4-char alphanumeric) |
| `join-room` | Client -> Server | `code: string` | Joins a room, returns `{ success: boolean, error?: string }` |
| `peer-joined` | Server -> Host | -- | Notifies the host that a guest has joined |
| `signal` | Client -> Server | `{ roomCode, signal }` | Relays WebRTC signaling data to the other peer |
| `signal` | Server -> Client | `{ signal }` | Forwarded signaling data from the other peer |

## Structure

```
src/
├── index.ts       # Express + Socket.io server setup, health endpoint
├── signaling.ts   # Socket.io event handlers
└── rooms.ts       # Room CRUD, code generation, auto-cleanup (1 hour TTL)
```

Room codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, L, 1 to avoid ambiguity).

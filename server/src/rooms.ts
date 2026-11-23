export interface Room {
  code: string;
  hostSocketId: string;
  guestSocketId: string | null;
  createdAt: number;
}

export const MAX_ROOMS = 10_000;
export const MAX_CODE_GENERATION_ATTEMPTS = 100;
export const ROOM_TTL_MS = 60 * 60 * 1000;
export const ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const ROOM_CODE_REGEX = /^[A-Z0-9]{4}$/;

const rooms = new Map<string, Room>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function normalizeRoomCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!ROOM_CODE_REGEX.test(normalized)) return null;
  return normalized;
}

export interface CreateRoomOptions {
  maxRooms?: number;
  maxAttempts?: number;
  codeGenerator?: () => string;
  now?: () => number;
}

export function createRoom(
  hostSocketId: string,
  options: CreateRoomOptions = {},
): Room | null {
  const {
    maxRooms = MAX_ROOMS,
    maxAttempts = MAX_CODE_GENERATION_ATTEMPTS,
    codeGenerator = generateCode,
    now = Date.now,
  } = options;

  // Ensure a single host socket cannot accumulate multiple rooms
  for (const [existingCode, existingRoom] of rooms) {
    if (existingRoom.hostSocketId === hostSocketId) {
      rooms.delete(existingCode);
    }
  }

  if (rooms.size >= maxRooms) {
    return null;
  }

  let code: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = codeGenerator();
    if (!rooms.has(candidate)) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    return null;
  }

  const room: Room = {
    code,
    hostSocketId,
    guestSocketId: null,
    createdAt: now(),
  };

  rooms.set(code, room);
  return room;
}

export function joinRoom(code: string, guestSocketId: string): Room | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;

  const room = rooms.get(normalized);
  if (!room) return null;
  if (room.hostSocketId === guestSocketId) return null; // cannot join own room
  if (room.guestSocketId) return null; // already full

  room.guestSocketId = guestSocketId;
  return room;
}

export function getRoom(code: string): Room | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;
  return rooms.get(normalized) ?? null;
}

export function removePlayerFromRooms(socketId: string): string[] {
  const removedCodes: string[] = [];
  for (const [code, room] of rooms) {
    if (room.hostSocketId === socketId || room.guestSocketId === socketId) {
      rooms.delete(code);
      removedCodes.push(code);
    }
  }
  return removedCodes;
}

export function getRoomCount(): number {
  return rooms.size;
}

export function clearRooms(): void {
  rooms.clear();
}

export function cleanupExpiredRooms(now = Date.now()): number {
  const cutoff = now - ROOM_TTL_MS;
  let removed = 0;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) {
      rooms.delete(code);
      removed++;
    }
  }
  return removed;
}

// Clean up rooms older than 1 hour
let cleanupTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  cleanupExpiredRooms();
}, ROOM_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

export function stopRoomCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

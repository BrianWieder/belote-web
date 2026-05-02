interface Room {
  code: string;
  hostSocketId: string;
  guestSocketId: string | null;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createRoom(hostSocketId: string): Room {
  let code = generateCode();
  while (rooms.has(code)) {
    code = generateCode();
  }

  const room: Room = {
    code,
    hostSocketId,
    guestSocketId: null,
    createdAt: Date.now(),
  };

  rooms.set(code, room);
  return room;
}

export function joinRoom(code: string, guestSocketId: string): Room | null {
  const room = rooms.get(code.toUpperCase());
  if (!room) return null;
  if (room.guestSocketId) return null; // already full

  room.guestSocketId = guestSocketId;
  return room;
}

export function getRoom(code: string): Room | null {
  return rooms.get(code.toUpperCase()) ?? null;
}

export function removeRoom(code: string): void {
  rooms.delete(code.toUpperCase());
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

// Clean up rooms older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) {
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

import type { Server, Socket } from 'socket.io';
import {
  createRoom,
  joinRoom,
  getRoom,
  normalizeRoomCode,
  removePlayerFromRooms,
} from './rooms.js';

export function setupSignaling(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on(
      'create-room',
      (callback?: (data: { code?: string; error?: string }) => void) => {
        const respond = (data: { code?: string; error?: string }) => {
          if (typeof callback === 'function') {
            callback(data);
          }
        };

        // Clean up any existing room(s) owned by or containing this socket first
        const removedCodes = removePlayerFromRooms(socket.id);
        for (const oldCode of removedCodes) {
          socket.leave(oldCode);
          io.to(oldCode).emit('peer-disconnected');
          io.in(oldCode).socketsLeave(oldCode);
        }

        const room = createRoom(socket.id);
        if (!room) {
          respond({ error: 'Unable to create room. Server is at capacity.' });
          return;
        }

        socket.join(room.code);
        respond({ code: room.code });
        console.log(`Room created: ${room.code} by ${socket.id}`);
      },
    );

    socket.on(
      'join-room',
      (
        code: unknown,
        callback?: (data: { success: boolean; error?: string }) => void,
      ) => {
        const respond = (data: { success: boolean; error?: string }) => {
          if (typeof callback === 'function') {
            callback(data);
          }
        };

        const normalizedCode = normalizeRoomCode(code);
        if (!normalizedCode) {
          respond({ success: false, error: 'Invalid room code' });
          return;
        }

        const room = joinRoom(normalizedCode, socket.id);
        if (!room) {
          respond({ success: false, error: 'Room not found or full' });
          return;
        }

        socket.join(room.code);
        respond({ success: true });

        // Notify host that guest joined
        io.to(room.hostSocketId).emit('peer-joined', { socketId: socket.id });
        console.log(`${socket.id} joined room ${room.code}`);
      },
    );

    // Relay WebRTC signaling data
    socket.on('signal', (data: unknown) => {
      if (
        typeof data !== 'object' ||
        data === null ||
        Array.isArray(data)
      ) {
        return;
      }

      const payload = data as { roomCode?: unknown; signal?: unknown };
      if (typeof payload.roomCode !== 'string' || payload.signal === undefined) {
        return;
      }

      const room = getRoom(payload.roomCode);
      if (!room) return;

      // Only relay for sockets that actually belong to the room
      const isMember =
        socket.id === room.hostSocketId || socket.id === room.guestSocketId;
      if (!isMember) return;

      // Send to the other peer in the room
      const targetId =
        socket.id === room.hostSocketId
          ? room.guestSocketId
          : room.hostSocketId;

      if (targetId) {
        io.to(targetId).emit('signal', {
          signal: payload.signal,
          from: socket.id,
        });
      }
    });

    socket.on('disconnect', () => {
      const removedCodes = removePlayerFromRooms(socket.id);
      for (const code of removedCodes) {
        io.to(code).emit('peer-disconnected');
        io.in(code).socketsLeave(code);
      }
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

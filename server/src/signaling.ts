import type { Server, Socket } from 'socket.io';
import { createRoom, joinRoom, getRoom, removePlayerFromRooms } from './rooms.js';

export function setupSignaling(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('create-room', (callback: (data: { code: string }) => void) => {
      const room = createRoom(socket.id);
      socket.join(room.code);
      callback({ code: room.code });
      console.log(`Room created: ${room.code} by ${socket.id}`);
    });

    socket.on('join-room', (code: string, callback: (data: { success: boolean; error?: string }) => void) => {
      const room = joinRoom(code, socket.id);
      if (!room) {
        callback({ success: false, error: 'Room not found or full' });
        return;
      }

      socket.join(room.code);
      callback({ success: true });

      // Notify host that guest joined
      io.to(room.hostSocketId).emit('peer-joined', { socketId: socket.id });
      console.log(`${socket.id} joined room ${room.code}`);
    });

    // Relay WebRTC signaling data
    socket.on('signal', (data: { roomCode: string; signal: unknown }) => {
      const room = getRoom(data.roomCode);
      if (!room) return;

      // Send to the other peer in the room
      const targetId = socket.id === room.hostSocketId
        ? room.guestSocketId
        : room.hostSocketId;

      if (targetId) {
        io.to(targetId).emit('signal', { signal: data.signal, from: socket.id });
      }
    });

    socket.on('disconnect', () => {
      const removedCodes = removePlayerFromRooms(socket.id);
      for (const code of removedCodes) {
        io.to(code).emit('peer-disconnected');
      }
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, { autoConnect: false });
  }
  return socket;
}

export function connectSignaling(): Promise<void> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    if (s.connected) {
      resolve();
      return;
    }
    s.connect();
    s.once('connect', () => resolve());
    s.once('connect_error', (err) => reject(err));
  });
}

export function createRoom(): Promise<string> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.emit('create-room', (data: { code: string }) => {
      resolve(data.code);
    });
  });
}

export function joinRoom(code: string): Promise<{ success: boolean; error?: string }> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.emit('join-room', code, (data: { success: boolean; error?: string }) => {
      resolve(data);
    });
  });
}

export function sendSignal(roomCode: string, signal: unknown): void {
  const s = getSocket();
  s.emit('signal', { roomCode, signal });
}

export function disconnectSignaling(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

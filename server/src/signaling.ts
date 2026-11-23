import type { Server, Socket } from 'socket.io';
import {
  cancelPendingJoin,
  confirmGuestSeat,
  createRoom,
  disconnectPlayerFromRooms,
  getRoom,
  joinRoom,
  leaveRoomByCreateAttempt,
  leaveRoomWithToken,
  markNegotiationComplete,
  normalizeRoomCode,
  rejoinRoom,
  removePlayerFromRooms,
  type PlayerRole,
} from './rooms.js';

function parseRoomCodeAndAttempt(input: unknown): {
  code: string | null;
  attemptId?: string;
  invalidAttemptId?: boolean;
} {
  if (typeof input === 'string') {
    return { code: normalizeRoomCode(input) };
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const obj = input as { code?: unknown; attemptId?: unknown };
    const code = normalizeRoomCode(obj.code);
    if ('attemptId' in obj && obj.attemptId !== undefined) {
      if (typeof obj.attemptId !== 'string' || obj.attemptId.length === 0) {
        return { code, invalidAttemptId: true };
      }
      return { code, attemptId: obj.attemptId };
    }
    return { code };
  }
  return { code: null };
}

export function setupSignaling(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on(
      'create-room',
      (
        arg1?:
          | { attemptId?: unknown }
          | ((data: {
              code?: string;
              reconnectToken?: string;
              error?: string;
            }) => void),
        arg2?: (data: {
          code?: string;
          reconnectToken?: string;
          error?: string;
        }) => void,
      ) => {
        const callback = typeof arg1 === 'function' ? arg1 : arg2;
        const attemptId =
          typeof arg1 === 'object' &&
          arg1 !== null &&
          !Array.isArray(arg1) &&
          typeof arg1.attemptId === 'string' &&
          arg1.attemptId.length > 0
            ? arg1.attemptId
            : undefined;

        const respond = (data: {
          code?: string;
          reconnectToken?: string;
          error?: string;
        }) => {
          if (typeof callback === 'function') {
            callback(data);
          }
        };

        // Clean up any existing room(s) owned by or containing this socket first
        const removed = removePlayerFromRooms(socket.id);
        for (const { code: oldCode, remainingSocketId } of removed) {
          socket.leave(oldCode);
          if (remainingSocketId) {
            io.to(remainingSocketId).emit('peer-disconnected', { preserved: false });
          } else {
            io.to(oldCode).emit('peer-disconnected', { preserved: false });
          }
          io.in(oldCode).socketsLeave(oldCode);
        }

        const room = createRoom(socket.id, { attemptId });
        if (!room) {
          respond({ error: 'Unable to create room. Server is at capacity.' });
          return;
        }

        socket.join(room.code);
        respond({ code: room.code, reconnectToken: room.hostToken });
        console.log(`Room created: ${room.code} by ${socket.id}`);
      },
    );

    socket.on(
      'join-room',
      (
        payload: unknown,
        callback?: (data: {
          success: boolean;
          error?: string;
          reconnectToken?: string;
        }) => void,
      ) => {
        const respond = (data: {
          success: boolean;
          error?: string;
          reconnectToken?: string;
        }) => {
          if (typeof callback === 'function') {
            callback(data);
          }
        };

        const { code: normalizedCode, attemptId, invalidAttemptId } =
          parseRoomCodeAndAttempt(payload);
        if (!normalizedCode || invalidAttemptId) {
          respond({ success: false, error: 'Invalid room code' });
          return;
        }

        const room = joinRoom(normalizedCode, socket.id, Date.now(), attemptId);
        if (!room || !room.hostSocketId || !room.guestToken) {
          respond({ success: false, error: 'Room not found or full' });
          return;
        }

        socket.join(room.code);
        respond({ success: true, reconnectToken: room.guestToken });

        // Notify host that guest joined
        io.to(room.hostSocketId).emit('peer-joined', { socketId: socket.id });
        console.log(`${socket.id} joined room ${room.code}`);
      },
    );

    socket.on('confirm-join', (payload: unknown) => {
      const { code: normalizedCode, attemptId, invalidAttemptId } =
        parseRoomCodeAndAttempt(payload);
      if (!normalizedCode || invalidAttemptId) return;
      confirmGuestSeat(normalizedCode, socket.id, attemptId);
    });

    socket.on(
      'peer-connected',
      (payload: unknown, callback?: (res: { ok: boolean }) => void) => {
        const respond = (ok: boolean) => {
          if (typeof callback === 'function') {
            callback({ ok });
          }
        };

        if (typeof payload === 'string') {
          const normalizedCode = normalizeRoomCode(payload);
          if (!normalizedCode) {
            respond(false);
            return;
          }
          respond(markNegotiationComplete(normalizedCode, socket.id));
          return;
        }
        if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
          const obj = payload as { code?: unknown; negotiationId?: unknown };
          const normalizedCode = normalizeRoomCode(obj.code);
          if (!normalizedCode) {
            respond(false);
            return;
          }
          const negotiationId =
            typeof obj.negotiationId === 'number' && Number.isInteger(obj.negotiationId)
              ? obj.negotiationId
              : undefined;
          respond(markNegotiationComplete(normalizedCode, socket.id, negotiationId));
          return;
        }
        respond(false);
      },
    );

    socket.on('cancel-join', (payload: unknown) => {
      const { code: normalizedCode, attemptId, invalidAttemptId } =
        parseRoomCodeAndAttempt(payload);
      if (!normalizedCode || invalidAttemptId) return;

      const cancelled = cancelPendingJoin(normalizedCode, socket.id, attemptId);
      if (!cancelled) return;

      socket.leave(cancelled.code);
      if (cancelled.hostSocketId) {
        io.to(cancelled.hostSocketId).emit('peer-join-cancelled');
      }
      console.log(`${socket.id} cancelled join for room ${cancelled.code}`);
    });

    socket.on(
      'rejoin-room',
      (
        data: unknown,
        callback?: (res: {
          success: boolean;
          error?: string;
          role?: PlayerRole;
          peerPresent?: boolean;
          alreadyNegotiating?: boolean;
          negotiationId?: number;
        }) => void,
      ) => {
        const respond = (res: {
          success: boolean;
          error?: string;
          role?: PlayerRole;
          peerPresent?: boolean;
          alreadyNegotiating?: boolean;
          negotiationId?: number;
        }) => {
          if (typeof callback === 'function') {
            callback(res);
          }
        };

        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          respond({ success: false, error: 'Invalid rejoin request' });
          return;
        }

        const payload = data as {
          code?: unknown;
          role?: unknown;
          token?: unknown;
          passive?: unknown;
          retry?: unknown;
          failedNegotiationId?: unknown;
        };

        if (
          typeof payload.code !== 'string' ||
          (payload.role !== 'host' && payload.role !== 'guest') ||
          typeof payload.token !== 'string'
        ) {
          respond({ success: false, error: 'Invalid rejoin request' });
          return;
        }

        const role: PlayerRole = payload.role;
        const failedNegotiationId =
          typeof payload.failedNegotiationId === 'number' &&
          Number.isInteger(payload.failedNegotiationId) &&
          payload.failedNegotiationId >= 0
            ? payload.failedNegotiationId
            : undefined;
        const result = rejoinRoom(payload.code, role, payload.token, socket.id, Date.now(), {
          passive: payload.passive === true,
          retry: payload.retry === true,
          ...(failedNegotiationId !== undefined ? { failedNegotiationId } : {}),
        });
        if (!result.ok) {
          respond({ success: false, error: result.error });
          return;
        }

        const { room, otherSocketId, alreadyNegotiating, negotiationId } = result;
        socket.join(room.code);
        const peerPresent = otherSocketId !== null;
        const ackPayload = {
          success: true,
          role,
          peerPresent,
          alreadyNegotiating,
          ...(negotiationId !== null ? { negotiationId } : {}),
        };

        if (peerPresent && !alreadyNegotiating) {
          const peerNotification = {
            role,
            ...(negotiationId !== null ? { negotiationId } : {}),
          };
          if (role === 'host') {
            // Host is rejoining while guest is waiting: notify guest FIRST so
            // guest attaches its signal listener before host sends the offer.
            io.to(otherSocketId).emit('peer-reconnected', peerNotification);
            respond(ackPayload);
          } else {
            // Guest is rejoining while host is waiting: ack guest FIRST so
            // guest attaches its signal listener before host sends the offer.
            respond(ackPayload);
            io.to(otherSocketId).emit('peer-reconnected', peerNotification);
          }
        } else {
          respond(ackPayload);
        }

        console.log(
          `${socket.id} rejoined room ${room.code} as ${role} (peerPresent=${peerPresent}, negotiationId=${negotiationId})`,
        );
      },
    );

    // Relay WebRTC signaling data
    socket.on('signal', (data: unknown) => {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
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

      // Once the guest is actively signaling, their join token is confirmed
      if (socket.id === room.guestSocketId && !room.guestConfirmed) {
        confirmGuestSeat(room.code, socket.id);
      }

      // Send to the other peer in the room
      const targetId =
        socket.id === room.hostSocketId ? room.guestSocketId : room.hostSocketId;

      if (targetId) {
        io.to(targetId).emit('signal', {
          roomCode: room.code,
          signal: payload.signal,
          from: socket.id,
        });
      }
    });

    socket.on(
      'leave-room',
      (payload?: unknown, callback?: (res: { ok: boolean }) => void) => {
        const ack = typeof payload === 'function' ? (payload as (res: { ok: boolean }) => void) : callback;
        const respond = (ok: boolean) => {
          if (typeof ack === 'function') {
            ack({ ok });
          }
        };

        // Unscoped leave-room (no payload) closes all rooms occupied by this socket.
        if (payload === undefined || typeof payload === 'function') {
          const removed = removePlayerFromRooms(socket.id);
          for (const { code, remainingSocketId } of removed) {
            socket.leave(code);
            if (remainingSocketId) {
              io.to(remainingSocketId).emit('peer-disconnected', {
                preserved: false,
                roomCode: code,
              });
            } else {
              io.to(code).emit('peer-disconnected', { preserved: false, roomCode: code });
            }
            io.in(code).socketsLeave(code);
          }
          respond(true);
          return;
        }

        // Malformed scoped payloads must not fall through to closing all rooms.
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          respond(false);
          return;
        }

        const req = payload as {
          code?: unknown;
          role?: unknown;
          token?: unknown;
          createAttemptId?: unknown;
        };

        // Scoped by create attempt ID (e.g. timed-out createRoom cleanup)
        if (typeof req.createAttemptId === 'string' && req.createAttemptId.length > 0) {
          const closed = leaveRoomByCreateAttempt(socket.id, req.createAttemptId);
          if (closed) {
            socket.leave(closed.code);
            if (closed.remainingSocketId) {
              io.to(closed.remainingSocketId).emit('peer-disconnected', {
                preserved: false,
                roomCode: closed.code,
              });
            } else {
              io.to(closed.code).emit('peer-disconnected', {
                preserved: false,
                roomCode: closed.code,
              });
            }
            io.in(closed.code).socketsLeave(closed.code);
          }
          respond(true);
          return;
        }

        // When room credentials are provided, scope closure strictly to that room
        // so cleanup for an abandoned room can never close a newer room on the same socket.
        if (
          typeof req.code === 'string' &&
          (req.role === 'host' || req.role === 'guest') &&
          typeof req.token === 'string'
        ) {
          const normalized = normalizeRoomCode(req.code);
          if (normalized) {
            const existed = getRoom(normalized) !== null;
            const closed = leaveRoomWithToken(normalized, req.role, req.token);
            if (closed) {
              socket.leave(closed.code);
              if (closed.provisionalCancelled) {
                if (closed.remainingSocketId) {
                  io.to(closed.remainingSocketId).emit('peer-join-cancelled');
                }
              } else {
                if (closed.remainingSocketId) {
                  io.to(closed.remainingSocketId).emit('peer-disconnected', {
                    preserved: false,
                    roomCode: closed.code,
                  });
                } else {
                  io.to(closed.code).emit('peer-disconnected', {
                    preserved: false,
                    roomCode: closed.code,
                  });
                }
                io.in(closed.code).socketsLeave(closed.code);
              }
              respond(true);
              return;
            }
            // Acknowledge as ok when the room is already gone; reject unauthorized tokens
            respond(!existed);
            return;
          }
        }

        respond(false);
      },
    );

    socket.on('disconnect', () => {
      const disconnected = disconnectPlayerFromRooms(socket.id);
      for (const {
        code,
        preserved,
        provisionalCancelled,
        remainingSocketId,
      } of disconnected) {
        if (provisionalCancelled) {
          // Unconfirmed guest disconnected: leave the room open and return host to lobby
          if (remainingSocketId) {
            io.to(remainingSocketId).emit('peer-join-cancelled');
          }
          continue;
        }
        if (remainingSocketId) {
          io.to(remainingSocketId).emit('peer-disconnected', { preserved, roomCode: code });
        } else if (!preserved) {
          io.to(code).emit('peer-disconnected', { preserved: false, roomCode: code });
        }
        if (!preserved) {
          io.in(code).socketsLeave(code);
        }
      }
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

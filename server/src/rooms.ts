import { randomBytes, timingSafeEqual } from 'node:crypto';

export type PlayerRole = 'host' | 'guest';

export interface Room {
  code: string;
  hostSocketId: string | null;
  guestSocketId: string | null;
  hostToken: string;
  guestToken: string | null;
  /** Attempt identifier for the host's create-room request (scopes timeout cleanup). */
  hostCreateAttemptId: string | null;
  /** Attempt identifier for a provisional (unconfirmed) guest join. */
  guestJoinAttemptId: string | null;
  /** True once the guest acknowledged receipt of their join-room token. */
  guestConfirmed: boolean;
  /** True once initial WebRTC setup completed (so disconnects use the grace window). */
  hasStarted: boolean;
  hostDisconnectedAt: number | null;
  guestDisconnectedAt: number | null;
  /** Tracks the most recent socket-id pair for which renegotiation was triggered. */
  lastRenegotiatedPair: string | null;
  lastRenegotiatedAt: number | null;
  negotiationId: number;
  /** Role of the peer that triggered an unfinished renegotiation (cleared on peer-connected). */
  pendingNegotiationInitiator: PlayerRole | null;
  /** Role of a peer that actively rejoined while the other seat was absent and is waiting for peer-reconnected. */
  waitingPeerRole: PlayerRole | null;
  createdAt: number;
}

export interface DisconnectResult {
  code: string;
  role: PlayerRole;
  preserved: boolean;
  /** True when a provisional (unconfirmed) guest disconnected and the room returned to lobby. */
  provisionalCancelled?: boolean;
  remainingSocketId: string | null;
}

export interface RejoinOptions {
  /** Restores the signaling seat without triggering WebRTC renegotiation (data channel still open). */
  passive?: boolean;
  /** True when retrying after a missed rejoin acknowledgement. */
  retry?: boolean;
  /** Negotiation ID of a replacement peer that failed locally and requires a fresh negotiation. */
  failedNegotiationId?: number;
}

export type RejoinResult =
  | {
      ok: true;
      room: Room;
      role: PlayerRole;
      otherSocketId: string | null;
      alreadyNegotiating: boolean;
      negotiationId: number | null;
    }
  | {
      ok: false;
      error: string;
    };

export const MAX_ROOMS = 10_000;
export const MAX_CODE_GENERATION_ATTEMPTS = 100;
export const RECONNECT_GRACE_MS = 2 * 60 * 1000;
export const ROOM_TTL_MS = 60 * 60 * 1000;
export const ROOM_CLEANUP_INTERVAL_MS = 30 * 1000;

const RENEGOTIATION_DEDUPE_MS = 5_000;
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

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function tokensMatch(expected: string | null, actual: string): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isRoomExpired(room: Room, now: number): boolean {
  if (now - room.createdAt > ROOM_TTL_MS) return true;
  if (
    room.hostSocketId === null &&
    room.hostDisconnectedAt !== null &&
    now - room.hostDisconnectedAt > RECONNECT_GRACE_MS
  ) {
    return true;
  }
  if (
    room.guestSocketId === null &&
    room.guestDisconnectedAt !== null &&
    now - room.guestDisconnectedAt > RECONNECT_GRACE_MS
  ) {
    return true;
  }
  return false;
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
  attemptId?: string;
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
    attemptId,
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
    hostToken: generateToken(),
    guestToken: null,
    hostCreateAttemptId: attemptId ?? null,
    guestJoinAttemptId: null,
    guestConfirmed: false,
    hasStarted: false,
    hostDisconnectedAt: null,
    guestDisconnectedAt: null,
    lastRenegotiatedPair: null,
    lastRenegotiatedAt: null,
    negotiationId: 0,
    pendingNegotiationInitiator: null,
    waitingPeerRole: null,
    createdAt: now(),
  };

  rooms.set(code, room);
  return room;
}

export function joinRoom(
  code: string,
  guestSocketId: string,
  now = Date.now(),
  attemptId?: string,
): Room | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;

  const room = rooms.get(normalized);
  if (!room) return null;
  if (isRoomExpired(room, now)) {
    rooms.delete(normalized);
    return null;
  }
  if (!room.hostSocketId || room.hostSocketId === guestSocketId) {
    return null;
  }

  // Allow the same guest socket to retry an unconfirmed/active join idempotently
  // (e.g. after a client-side join timeout) while updating the latest attempt ID.
  if (room.guestSocketId === guestSocketId && room.guestToken) {
    room.guestDisconnectedAt = null;
    if (attemptId !== undefined) {
      room.guestJoinAttemptId = attemptId;
    }
    return room;
  }

  if (room.hasStarted || room.guestSocketId) {
    return null;
  }

  room.guestSocketId = guestSocketId;
  room.guestToken = generateToken();
  room.guestJoinAttemptId = attemptId ?? null;
  room.guestConfirmed = false;
  // Keep hasStarted false until the initial WebRTC data channel opens (peer-connected)
  room.hasStarted = false;
  room.guestDisconnectedAt = null;
  return room;
}

/**
 * Records that the guest acknowledged receipt of the join-room token so stale
 * `cancel-join` requests cannot evict them. Does not mark `hasStarted` until
 * WebRTC setup completes (`markNegotiationComplete`), keeping pre-connect drops retryable.
 */
export function confirmGuestSeat(
  code: string,
  guestSocketId: string,
  attemptId?: string,
): boolean {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return false;
  const room = rooms.get(normalized);
  if (!room || room.guestSocketId !== guestSocketId) return false;
  if (attemptId !== undefined && room.guestJoinAttemptId !== attemptId) {
    return false;
  }
  room.guestConfirmed = true;
  room.guestJoinAttemptId = null;
  return true;
}

/**
 * Marks initial WebRTC setup complete (`hasStarted = true`) and clears the
 * renegotiation dedupe window ONLY when `negotiationId` matches the room's
 * current negotiation (so a stale passive-restore completion cannot clear a
 * newer active negotiation).
 */
export function markNegotiationComplete(
  code: string,
  socketId: string,
  negotiationId?: number,
): boolean {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return false;
  const room = rooms.get(normalized);
  if (!room) return false;
  if (room.hostSocketId !== socketId && room.guestSocketId !== socketId) {
    return false;
  }

  // Initial setup transitions `hasStarted` only when the current guest confirms
  // receipt and initialization from `sync-seed` / `resume-game`, keeping failed
  // pre-start connections retryable for the lobby room.
  if (!room.hasStarted) {
    if (room.guestSocketId !== socketId) {
      return false;
    }
    if (negotiationId !== undefined && negotiationId !== room.negotiationId) {
      return false;
    }
    room.hasStarted = true;
    room.lastRenegotiatedPair = null;
    room.lastRenegotiatedAt = null;
    room.pendingNegotiationInitiator = null;
    room.waitingPeerRole = null;
    return true;
  }

  if (negotiationId === undefined || negotiationId === room.negotiationId) {
    room.lastRenegotiatedPair = null;
    room.lastRenegotiatedAt = null;
    room.pendingNegotiationInitiator = null;
    room.waitingPeerRole = null;
  }
  return true;
}

/**
 * Releases a provisional guest join when the client timed out before receiving
 * the join acknowledgement, returning the room to its open lobby state so the
 * guest can retry cleanly. If `attemptId` is provided, cancellation only
 * applies when it matches the room's active provisional attempt.
 */
export function cancelPendingJoin(
  code: string,
  guestSocketId: string,
  attemptId?: string,
): { code: string; hostSocketId: string | null } | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;

  const room = rooms.get(normalized);
  if (!room || room.guestSocketId !== guestSocketId || room.guestConfirmed || room.hasStarted) {
    return null;
  }
  if (attemptId !== undefined && room.guestJoinAttemptId !== attemptId) {
    return null;
  }

  room.guestSocketId = null;
  room.guestToken = null;
  room.guestJoinAttemptId = null;
  room.guestConfirmed = false;
  room.hasStarted = false;
  room.guestDisconnectedAt = null;
  room.lastRenegotiatedPair = null;
  room.lastRenegotiatedAt = null;
  return { code: room.code, hostSocketId: room.hostSocketId };
}

export function rejoinRoom(
  code: string,
  role: PlayerRole,
  token: string,
  socketId: string,
  now = Date.now(),
  options: RejoinOptions = {},
): RejoinResult {
  const normalized = normalizeRoomCode(code);
  if (!normalized) {
    return { ok: false, error: 'Invalid room code' };
  }

  const room = rooms.get(normalized);
  if (!room) {
    return { ok: false, error: 'Room not found or expired' };
  }

  if (isRoomExpired(room, now)) {
    rooms.delete(normalized);
    return { ok: false, error: 'Reconnect window expired' };
  }

  if (!room.hasStarted) {
    return { ok: false, error: 'Game has not started' };
  }

  const previousSocketId = role === 'host' ? room.hostSocketId : room.guestSocketId;
  const socketChanged = previousSocketId !== socketId;

  if (role === 'host') {
    if (!tokensMatch(room.hostToken, token)) {
      return { ok: false, error: 'Invalid reconnect token' };
    }
    room.hostSocketId = socketId;
    room.hostDisconnectedAt = null;
  } else {
    if (!tokensMatch(room.guestToken, token)) {
      return { ok: false, error: 'Invalid reconnect token' };
    }
    room.guestSocketId = socketId;
    room.guestDisconnectedAt = null;
  }

  const otherSocketId = role === 'host' ? room.guestSocketId : room.hostSocketId;
  const currentPair =
    room.hostSocketId && room.guestSocketId
      ? `${room.hostSocketId}:${room.guestSocketId}`
      : null;
  const otherPeerWaiting =
    otherSocketId !== null &&
    room.waitingPeerRole !== null &&
    room.waitingPeerRole !== role;
  // If an unfinished negotiation was started on a different socket pair (whether
  // initiated by the opponent or by this role before dropping signaling), restoring
  // our seat on a new socket must promote to a fresh matching negotiation so neither
  // side stays waiting for an offer from a superseded connection.
  const hasUnmatchedPendingNegotiation =
    currentPair !== null &&
    room.pendingNegotiationInitiator !== null &&
    room.lastRenegotiatedPair !== currentPair;
  // An active rejoin from a replaced socket always needs a fresh negotiation for
  // the new socket pair even if the prior negotiation had already completed.
  const mustNegotiate =
    otherPeerWaiting ||
    hasUnmatchedPendingNegotiation ||
    (!options.passive && socketChanged);

  // Passive seat restoration (signaling reconnected while WebRTC data channel stayed open):
  // restore the socket ID and cancel the grace timer without triggering renegotiation,
  // UNLESS the other peer is waiting for `peer-reconnected`, there is an unmatched pending
  // negotiation, or a guest retry is recovering a lost ACK for a pending negotiation on this pair.
  const hasPendingNegotiationForPair =
    currentPair !== null &&
    room.pendingNegotiationInitiator !== null &&
    room.lastRenegotiatedPair === currentPair;
  if (
    options.passive &&
    !mustNegotiate &&
    !(hasPendingNegotiationForPair && options.retry && role === 'guest')
  ) {
    return {
      ok: true,
      room,
      role,
      otherSocketId,
      alreadyNegotiating: true,
      negotiationId: hasPendingNegotiationForPair ? room.negotiationId : null,
    };
  }

  let alreadyNegotiating = false;
  let negotiationId: number | null = null;

  if (currentPair !== null) {
    room.waitingPeerRole = null;
    const withinDedupeWindow =
      room.lastRenegotiatedPair === currentPair &&
      room.lastRenegotiatedAt !== null &&
      now - room.lastRenegotiatedAt < RENEGOTIATION_DEDUPE_MS;
    const failedCurrentNegotiation =
      options.failedNegotiationId !== undefined &&
      options.failedNegotiationId === room.negotiationId;
    const staleFailedNegotiation =
      options.failedNegotiationId !== undefined &&
      options.failedNegotiationId !== room.negotiationId;

    // A stale failure report for a superseded negotiation must never disturb the
    // current negotiation even after the dedupe window expires, EXCEPT when
    // `mustNegotiate` is true (e.g. socket pair changed or peer is waiting).
    if (
      !mustNegotiate &&
      (staleFailedNegotiation ||
        (withinDedupeWindow &&
          !failedCurrentNegotiation &&
          !(role === 'guest' && options.retry && options.failedNegotiationId === undefined)))
    ) {
      alreadyNegotiating = true;
      negotiationId = room.negotiationId;
    } else {
      room.negotiationId += 1;
      room.lastRenegotiatedPair = currentPair;
      room.lastRenegotiatedAt = now;
      room.pendingNegotiationInitiator = role;
      negotiationId = room.negotiationId;
    }
  } else if (!options.passive) {
    room.waitingPeerRole = role;
  }

  return { ok: true, room, role, otherSocketId, alreadyNegotiating, negotiationId };
}

export function getRoom(code: string): Room | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;
  return rooms.get(normalized) ?? null;
}

/**
 * Handles an unexpected socket disconnect.
 * - Unstarted lobby rooms (host disconnects before a confirmed match) are deleted.
 * - Provisional (unconfirmed) guest disconnects release the guest slot so the
 *   room returns to its open lobby state and the guest can rejoin on a new socket.
 * - Confirmed active rooms keep the player's slot open for the 2-minute grace window.
 */
export function disconnectPlayerFromRooms(
  socketId: string,
  now = Date.now(),
): DisconnectResult[] {
  const results: DisconnectResult[] = [];
  for (const [code, room] of rooms) {
    if (room.hostSocketId === socketId) {
      if (!room.hasStarted) {
        const remainingSocketId = room.guestSocketId;
        rooms.delete(code);
        results.push({ code, role: 'host', preserved: false, remainingSocketId });
      } else {
        room.hostSocketId = null;
        room.hostDisconnectedAt = now;
        if (room.waitingPeerRole === 'host') room.waitingPeerRole = null;
        results.push({
          code,
          role: 'host',
          preserved: true,
          remainingSocketId: room.guestSocketId,
        });
      }
    } else if (room.guestSocketId === socketId) {
      if (!room.hasStarted) {
        // Guest disconnected before initial WebRTC setup completed — release slot
        // so the host stays in the lobby and the guest can retry with a new socket.
        room.guestSocketId = null;
        room.guestToken = null;
        room.guestJoinAttemptId = null;
        room.guestConfirmed = false;
        room.guestDisconnectedAt = null;
        results.push({
          code,
          role: 'guest',
          preserved: false,
          provisionalCancelled: true,
          remainingSocketId: room.hostSocketId,
        });
      } else {
        room.guestSocketId = null;
        room.guestDisconnectedAt = now;
        if (room.waitingPeerRole === 'guest') room.waitingPeerRole = null;
        results.push({
          code,
          role: 'guest',
          preserved: true,
          remainingSocketId: room.hostSocketId,
        });
      }
    }
  }
  return results;
}

/**
 * Handles an explicit player departure (e.g. clicking "Leave table",
 * "Return to lobby", or creating a new room). Deletes the room immediately
 * so the peer does not wait for a reconnect timeout.
 */
export function removePlayerFromRooms(socketId: string): DisconnectResult[] {
  const results: DisconnectResult[] = [];
  for (const [code, room] of rooms) {
    if (room.hostSocketId === socketId) {
      rooms.delete(code);
      results.push({
        code,
        role: 'host',
        preserved: false,
        remainingSocketId: room.guestSocketId,
      });
    } else if (room.guestSocketId === socketId) {
      rooms.delete(code);
      results.push({
        code,
        role: 'guest',
        preserved: false,
        remainingSocketId: room.hostSocketId,
      });
    }
  }
  return results;
}

/**
 * Closes a room only if it is currently hosted by `hostSocketId` and matches
 * the specific `attemptId` from a timed-out `create-room` request, ensuring a
 * newer room created on the same socket is never affected.
 */
export function leaveRoomByCreateAttempt(
  hostSocketId: string,
  attemptId: string,
): DisconnectResult | null {
  if (!attemptId) return null;
  for (const [code, room] of rooms) {
    if (
      room.hostSocketId === hostSocketId &&
      room.hostCreateAttemptId === attemptId
    ) {
      rooms.delete(code);
      return {
        code: room.code,
        role: 'host',
        preserved: false,
        remainingSocketId: room.guestSocketId,
      };
    }
  }
  return null;
}

/**
 * Closes a reserved room using a player's reconnect token when their signaling
 * socket was disconnected or rebound to a new socket ID before clicking
 * "Return to lobby". Does not restore the seat or peer.
 */
export function leaveRoomWithToken(
  code: string,
  role: PlayerRole,
  token: string,
): DisconnectResult | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;
  const room = rooms.get(normalized);
  if (!room) return null;

  const expectedToken = role === 'host' ? room.hostToken : room.guestToken;
  if (!tokensMatch(expectedToken, token)) return null;

  // If the guest backs out before the match has started, release only the guest
  // seat so the host's lobby invitation stays valid for retry.
  if (role === 'guest' && !room.hasStarted) {
    room.guestSocketId = null;
    room.guestToken = null;
    room.guestJoinAttemptId = null;
    room.guestConfirmed = false;
    room.guestDisconnectedAt = null;
    room.lastRenegotiatedPair = null;
    room.lastRenegotiatedAt = null;
    return {
      code: room.code,
      role: 'guest',
      preserved: false,
      provisionalCancelled: true,
      remainingSocketId: room.hostSocketId,
    };
  }

  const remainingSocketId =
    role === 'host' ? room.guestSocketId : room.hostSocketId;
  rooms.delete(normalized);
  return {
    code: room.code,
    role,
    preserved: false,
    remainingSocketId,
  };
}

export function getRoomCount(): number {
  return rooms.size;
}

export function clearRooms(): void {
  rooms.clear();
}

export function cleanupExpiredRooms(now = Date.now()): number {
  let removed = 0;
  for (const [code, room] of rooms) {
    if (isRoomExpired(room, now)) {
      rooms.delete(code);
      removed++;
    }
  }
  return removed;
}

// Periodically clean up expired rooms (1 hour TTL or expired 2-minute reconnect window)
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

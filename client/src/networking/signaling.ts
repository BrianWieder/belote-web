import { io, Socket } from 'socket.io-client';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const HAS_HIERARCHICAL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const HAS_NON_PORT_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d+(?:[/?#]|$))/;

function isValidSchemelessHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) {
    return true;
  }
  return (
    normalized.includes('.') &&
    !normalized.startsWith('.') &&
    !normalized.endsWith('.') &&
    !normalized.includes('..')
  );
}

export function resolveServerUrl(rawUrl?: string): string {
  const value = (rawUrl ?? '').trim() || 'http://localhost:3001';
  let parsed: URL;
  if (HAS_HIERARCHICAL_SCHEME.test(value) || HAS_NON_PORT_SCHEME.test(value)) {
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Invalid signaling server URL: "${value}"`);
    }
  } else {
    // Support bare hostnames (e.g. Railway's RAILWAY_PUBLIC_DOMAIN such as
    // "belote-server.bwieder.com") and protocol-relative URLs ("//host").
    const candidate = value.startsWith('//') ? value.slice(2) : value;
    if (!candidate || candidate.startsWith('/') || /\s/.test(candidate)) {
      throw new Error(`Invalid signaling server URL: "${value}"`);
    }
    try {
      parsed = new URL(`https://${candidate}`);
    } catch {
      throw new Error(`Invalid signaling server URL: "${value}"`);
    }
    if (
      parsed.username ||
      parsed.password ||
      !isValidSchemelessHost(parsed.hostname)
    ) {
      throw new Error(`Invalid signaling server URL: "${value}"`);
    }
    if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      parsed = new URL(`http://${candidate}`);
    }
  }

  const isSecure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  const isCleartextHttp = parsed.protocol === 'http:' || parsed.protocol === 'ws:';
  if (!isSecure && !isCleartextHttp) {
    throw new Error(`Unsupported signaling server protocol: "${parsed.protocol}"`);
  }
  if (isCleartextHttp && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `Signaling server origin "${parsed.origin}" must use https:// (or wss://) for non-loopback hosts`,
    );
  }
  const serialized = parsed.toString();
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
    return serialized.replace(/\/$/, '');
  }
  return serialized;
}

export const SERVER_URL = resolveServerUrl(import.meta.env.VITE_SERVER_URL);
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const LEAVE_ACK_TIMEOUT_MS = 3_000;
const MAX_LEAVE_RETRY_ATTEMPTS = 3;
const LEAVE_RETRY_DELAY_MS = 500;
const LEAVE_DELIVERY_DEADLINE_MS = 10_000;

export type PlayerRole = 'host' | 'guest';

export interface CreateRoomResult {
  code: string;
  reconnectToken: string;
}

export interface JoinRoomResult {
  success: boolean;
  error?: string;
  reconnectToken?: string;
}

export interface RejoinRoomResult {
  success: boolean;
  error?: string;
  role?: PlayerRole;
  peerPresent?: boolean;
  alreadyNegotiating?: boolean;
  negotiationId?: number;
}

export interface RejoinRoomOptions {
  passive?: boolean;
  retry?: boolean;
  failedNegotiationId?: number;
}

export interface LeaveRoomCredentials {
  code: string;
  role: PlayerRole;
  token: string;
}

export interface LeaveRoomOptions {
  /** Disconnect signaling once all pending credentialed departures finish or exhaust retries. */
  disconnectAfter?: boolean;
}

interface PendingLeaveEntry {
  creds: LeaveRoomCredentials;
  attempts: number;
  inFlight: boolean;
  expiresAt: number;
}

let socket: Socket | null = null;
let createAttemptCounter = 0;
let latestCreateAttemptId: string | null = null;
let joinAttemptCounter = 0;
const latestJoinAttemptByRoom = new Map<string, string>();
const pendingLeaveRequests = new Map<string, PendingLeaveEntry>();
let pendingLeaveFlushHandler: (() => void) | null = null;
let pendingLeaveDisconnectHandler: (() => void) | null = null;
let pendingLeaveRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLeaveDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
let disconnectAfterLeavesPending = false;

function clearPendingLeaveListeners(s: Socket): void {
  if (pendingLeaveFlushHandler) {
    s.off('connect', pendingLeaveFlushHandler);
    pendingLeaveFlushHandler = null;
  }
  if (pendingLeaveDisconnectHandler) {
    s.off('disconnect', pendingLeaveDisconnectHandler);
    pendingLeaveDisconnectHandler = null;
  }
  if (pendingLeaveRetryTimer !== null) {
    clearTimeout(pendingLeaveRetryTimer);
    pendingLeaveRetryTimer = null;
  }
  if (pendingLeaveDeadlineTimer !== null) {
    clearTimeout(pendingLeaveDeadlineTimer);
    pendingLeaveDeadlineTimer = null;
  }
}

function finalizePendingLeavesIfIdle(s: Socket): void {
  if (pendingLeaveRequests.size > 0) return;
  clearPendingLeaveListeners(s);
  if (disconnectAfterLeavesPending) {
    disconnectAfterLeavesPending = false;
    // Always call disconnect() even if currently offline so Socket.IO's
    // automatic reconnection stops after an explicit departure finishes.
    s.disconnect();
  }
}

function pruneExpiredPendingLeaves(s: Socket): void {
  const now = performance.now();
  for (const [key, entry] of pendingLeaveRequests) {
    if (now >= entry.expiresAt) {
      pendingLeaveRequests.delete(key);
    }
  }
  finalizePendingLeavesIfIdle(s);
}

function schedulePendingLeaveDeadline(s: Socket): void {
  if (pendingLeaveDeadlineTimer !== null) {
    clearTimeout(pendingLeaveDeadlineTimer);
    pendingLeaveDeadlineTimer = null;
  }
  if (pendingLeaveRequests.size === 0) return;

  let earliestExpiry = Infinity;
  for (const entry of pendingLeaveRequests.values()) {
    if (entry.expiresAt < earliestExpiry) {
      earliestExpiry = entry.expiresAt;
    }
  }
  const delay = Math.max(0, earliestExpiry - performance.now());
  pendingLeaveDeadlineTimer = setTimeout(() => {
    pendingLeaveDeadlineTimer = null;
    pruneExpiredPendingLeaves(s);
    if (pendingLeaveRequests.size > 0) {
      schedulePendingLeaveDeadline(s);
    }
  }, delay);
}

function schedulePendingLeaveRetry(s: Socket): void {
  if (pendingLeaveRetryTimer !== null || pendingLeaveRequests.size === 0) return;
  pendingLeaveRetryTimer = setTimeout(() => {
    pendingLeaveRetryTimer = null;
    pruneExpiredPendingLeaves(s);
    if (pendingLeaveRequests.size === 0) return;
    if (s.connected) {
      flushPendingLeaveRequests(s);
    } else {
      // Attempt a bounded reconnect to deliver the queued departure without restoring any peer
      s.connect();
    }
  }, LEAVE_RETRY_DELAY_MS);
}

function flushPendingLeaveRequests(s: Socket): void {
  pruneExpiredPendingLeaves(s);
  if (!s.connected || pendingLeaveRequests.size === 0) return;
  for (const [key, entry] of pendingLeaveRequests) {
    if (entry.inFlight) continue;
    const remainingMs = entry.expiresAt - performance.now();
    if (entry.attempts >= MAX_LEAVE_RETRY_ATTEMPTS || remainingMs <= 0) {
      pendingLeaveRequests.delete(key);
      continue;
    }
    const attemptTimeoutMs = Math.min(LEAVE_ACK_TIMEOUT_MS, Math.max(1, Math.ceil(remainingMs)));
    entry.inFlight = true;
    entry.attempts += 1;
    const attemptNumber = entry.attempts;

    const handleOutcome = (err: Error | null, ack?: { ok?: boolean }) => {
      const current = pendingLeaveRequests.get(key);
      if (current !== entry || entry.attempts !== attemptNumber) return;
      entry.inFlight = false;
      if (!err && ack?.ok !== false) {
        pendingLeaveRequests.delete(key);
        finalizePendingLeavesIfIdle(s);
        return;
      }
      if (entry.attempts >= MAX_LEAVE_RETRY_ATTEMPTS || performance.now() >= entry.expiresAt) {
        pendingLeaveRequests.delete(key);
        finalizePendingLeavesIfIdle(s);
        return;
      }
      schedulePendingLeaveRetry(s);
    };

    if (typeof s.timeout === 'function') {
      s.timeout(attemptTimeoutMs).emit(
        'leave-room',
        entry.creds,
        (err: Error | null, ack?: { ok?: boolean }) => {
          handleOutcome(err, ack);
        },
      );
    } else {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        handleOutcome(new Error('leave-room timed out'));
      }, attemptTimeoutMs);
      s.emit('leave-room', entry.creds, (ack?: { ok?: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handleOutcome(null, ack);
      });
    }
  }
  finalizePendingLeavesIfIdle(s);
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, { autoConnect: false });
  }
  return socket;
}

export function isSignalingConnected(): boolean {
  return Boolean(socket?.connected);
}

/**
 * Emits a Socket.IO request with transport-level acknowledgement timeout
 * (`socket.timeout(ms).emit(...)`) so unsent buffered packets are discarded
 * on timeout rather than delivered later after the caller gave up.
 */
function emitWithTimeout<T>(
  s: Socket,
  event: string,
  args: unknown[],
  timeoutMs: number,
  timeoutMessage: string,
  disconnectMessage: string,
  onTimeout?: () => void,
  onLateAck?: (data: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let abandoned = false;

    const cleanup = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      s.off('disconnect', onDisconnect);
    };

    const onDisconnect = () => {
      if (settled) return;
      settled = true;
      abandoned = true;
      cleanup();
      reject(new Error(disconnectMessage));
    };

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    s.on('disconnect', onDisconnect);

    if (typeof s.timeout === 'function') {
      s.timeout(timeoutMs).emit(event, ...args, (err: Error | null, data: T) => {
        if (err) {
          if (settled) {
            // If an abandoned request was buffered across a disconnect and timed out
            // after reconnecting, run attempt-scoped cleanup without changing the settled result.
            if (abandoned) {
              onTimeout?.();
            }
            return;
          }
          settled = true;
          timedOut = true;
          cleanup();
          onTimeout?.();
          reject(new Error(timeoutMessage));
          return;
        }
        if (settled) {
          if (timedOut || abandoned) {
            onLateAck?.(data);
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(data);
      });
    } else {
      fallbackTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        timedOut = true;
        cleanup();
        onTimeout?.();
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      s.emit(event, ...args, (data: T) => {
        if (settled) {
          if (timedOut || abandoned) {
            onLateAck?.(data);
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(data);
      });
    }
  });
}

export function connectSignaling(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<void> {
  disconnectAfterLeavesPending = false;
  const s = getSocket();
  return new Promise((resolve, reject) => {
    if (s.connected) {
      resolve();
      return;
    }

    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      s.off('connect', onConnect);
      s.off('connect_error', onError);
    };

    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection to signaling server timed out'));
    }, timeoutMs);

    s.on('connect', onConnect);
    s.on('connect_error', onError);
    s.connect();
  });
}

export async function createRoom(
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<CreateRoomResult> {
  const s = getSocket();
  const attemptId = String(++createAttemptCounter);
  latestCreateAttemptId = attemptId;
  const data = await emitWithTimeout<
    { code?: string; reconnectToken?: string; error?: string } | undefined
  >(
    s,
    'create-room',
    [{ attemptId }],
    timeoutMs,
    'Creating room timed out',
    'Disconnected while creating room',
    () => {
      // Only release a room created by this attempt so an overlapping newer
      // createRoom call on the same socket is never closed.
      if (latestCreateAttemptId !== attemptId) return;
      if (s.connected) {
        s.emit('leave-room', { createAttemptId: attemptId });
      }
    },
    (lateData) => {
      // Clean up a buffered create-room that succeeded after disconnect rejection
      // using its specific room credentials so a newer room is never affected.
      if (lateData?.code && lateData.reconnectToken && s.connected) {
        s.emit('leave-room', {
          code: lateData.code,
          role: 'host',
          token: lateData.reconnectToken,
        });
      }
    },
  );

  if (data?.code) {
    return {
      code: data.code,
      reconnectToken: data.reconnectToken ?? '',
    };
  }
  throw new Error(data?.error || 'Failed to create room');
}

export async function joinRoom(
  code: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  isCurrent?: () => boolean,
): Promise<JoinRoomResult> {
  const s = getSocket();
  const normalizedKey = code.trim().toUpperCase();
  const attemptId = String(++joinAttemptCounter);
  latestJoinAttemptByRoom.set(normalizedKey, attemptId);

  const emitScopedCancel = () => {
    // Only cancel if no newer join attempt for this room has superseded this attempt.
    if (latestJoinAttemptByRoom.get(normalizedKey) !== attemptId) return;
    if (s.connected) {
      s.emit('cancel-join', { code, attemptId });
    }
  };

  const data = await emitWithTimeout<JoinRoomResult>(
    s,
    'join-room',
    [{ code, attemptId }],
    timeoutMs,
    'Joining room timed out',
    'Disconnected while joining room',
    emitScopedCancel,
    (lateData) => {
      if (lateData?.success) {
        emitScopedCancel();
      }
    },
  );

  if (data?.success && s.connected && latestJoinAttemptByRoom.get(normalizedKey) === attemptId) {
    if (isCurrent && !isCurrent()) {
      // The caller's session moved on before the join ACK arrived: release the
      // provisional seat with a scoped cancel-join instead of confirming it.
      emitScopedCancel();
      return data;
    }
    // Confirm the provisional guest seat scoped to this attemptId so a late ACK
    // for an earlier attempt can never confirm a newer join attempt on the same socket.
    s.emit('confirm-join', { code, attemptId });
  }
  return data;
}

export function rejoinRoom(
  code: string,
  role: PlayerRole,
  token: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  options: RejoinRoomOptions = {},
): Promise<RejoinRoomResult> {
  const s = getSocket();
  const payload = {
    code,
    role,
    token,
    ...(options.passive ? { passive: true } : {}),
    ...(options.retry ? { retry: true } : {}),
    ...(options.failedNegotiationId !== undefined
      ? { failedNegotiationId: options.failedNegotiationId }
      : {}),
  };
  return emitWithTimeout<RejoinRoomResult>(
    s,
    'rejoin-room',
    [payload],
    timeoutMs,
    'Rejoining room timed out',
    'Disconnected while rejoining room',
  );
}

export function notifyPeerConnected(roomCode: string, negotiationId?: number): void {
  if (socket?.connected && roomCode) {
    socket.emit('peer-connected', {
      code: roomCode,
      ...(negotiationId !== undefined ? { negotiationId } : {}),
    });
  }
}

export type ConfirmPeerConnectedResult = 'confirmed' | 'rejected' | 'ambiguous';

export async function confirmPeerConnected(
  roomCode: string,
  negotiationId?: number,
  timeoutMs = 4_000,
): Promise<ConfirmPeerConnectedResult> {
  if (!roomCode) {
    return 'rejected';
  }
  if (!socket?.connected) {
    return 'ambiguous';
  }
  try {
    const res = await emitWithTimeout<{ ok?: boolean } | undefined>(
      socket,
      'peer-connected',
      [
        {
          code: roomCode,
          ...(negotiationId !== undefined ? { negotiationId } : {}),
        },
      ],
      timeoutMs,
      'Confirming room start timed out',
      'Disconnected while confirming room start',
    );
    return res?.ok ? 'confirmed' : 'rejected';
  } catch {
    return 'ambiguous';
  }
}

export function leaveRoom(
  credentials?: LeaveRoomCredentials,
  options: LeaveRoomOptions = {},
): void {
  const s = getSocket();
  if (!credentials) {
    if (s.connected) {
      s.emit('leave-room');
    }
    if (options.disconnectAfter) {
      if (pendingLeaveRequests.size === 0) {
        s.disconnect();
      } else {
        disconnectAfterLeavesPending = true;
      }
    }
    return;
  }

  const key = credentials.code.trim().toUpperCase();
  pendingLeaveRequests.set(key, {
    creds: credentials,
    attempts: 0,
    inFlight: false,
    expiresAt: performance.now() + LEAVE_DELIVERY_DEADLINE_MS,
  });

  if (options.disconnectAfter) {
    disconnectAfterLeavesPending = true;
  }

  if (!pendingLeaveFlushHandler) {
    pendingLeaveFlushHandler = () => {
      flushPendingLeaveRequests(s);
    };
    s.on('connect', pendingLeaveFlushHandler);
  }
  if (!pendingLeaveDisconnectHandler) {
    pendingLeaveDisconnectHandler = () => {
      for (const entry of pendingLeaveRequests.values()) {
        entry.inFlight = false;
      }
    };
    s.on('disconnect', pendingLeaveDisconnectHandler);
  }

  schedulePendingLeaveDeadline(s);

  if (s.connected) {
    flushPendingLeaveRequests(s);
  } else {
    // Initiate a bounded signaling reconnect attempt to deliver the departure
    // immediately without blocking the local return to lobby.
    s.connect();
  }
}

export function sendSignal(roomCode: string, signal: unknown): void {
  const s = getSocket();
  s.emit('signal', { roomCode, signal });
}

export function disconnectSignaling(): void {
  // Keep the socket instance (and its listeners, e.g. peer-joined) so a
  // later connectSignaling() can simply reconnect instead of re-registering.
  socket?.disconnect();
}

/** @internal Exposed for unit tests to reset module-level socket state. */
export function resetSignalingSocketForTests(): void {
  if (socket) {
    clearPendingLeaveListeners(socket);
  } else {
    if (pendingLeaveRetryTimer !== null) {
      clearTimeout(pendingLeaveRetryTimer);
      pendingLeaveRetryTimer = null;
    }
    if (pendingLeaveDeadlineTimer !== null) {
      clearTimeout(pendingLeaveDeadlineTimer);
      pendingLeaveDeadlineTimer = null;
    }
  }
  pendingLeaveFlushHandler = null;
  pendingLeaveDisconnectHandler = null;
  pendingLeaveRequests.clear();
  disconnectAfterLeavesPending = false;
  socket?.disconnect();
  socket = null;
  createAttemptCounter = 0;
  latestCreateAttemptId = null;
  joinAttemptCounter = 0;
  latestJoinAttemptByRoom.clear();
}

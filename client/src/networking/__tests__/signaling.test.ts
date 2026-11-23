import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

class MockSocket {
  connected = false;
  listeners = new Map<string, Set<Listener>>();
  emitted: Array<{ event: string; args: unknown[]; timeoutMs?: number }> = [];

  on = vi.fn((event: string, fn: Listener) => {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return this;
  });

  off = vi.fn((event: string, fn?: Listener) => {
    if (!fn) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(fn);
    }
    return this;
  });

  emit = vi.fn((event: string, ...args: unknown[]) => {
    this.emitted.push({ event, args });
    return this;
  });

  timeout = vi.fn((ms: number) => ({
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1];
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        if (typeof ack === 'function') {
          (ack as (err: Error | null, res?: unknown) => void)(
            new Error('operation has timed out'),
          );
        }
      }, ms);

      const wrappedAck = (res: unknown) => {
        if (done) return;
        clearTimeout(timer);
        done = true;
        if (typeof ack === 'function') {
          (ack as (err: Error | null, data?: unknown) => void)(null, res);
        }
      };

      const recordArgs = [...args.slice(0, -1), wrappedAck];
      this.emitted.push({ event, args: recordArgs, timeoutMs: ms });
      return this;
    },
  }));

  connect = vi.fn(() => this);
  disconnect = vi.fn(() => {
    this.connected = false;
    return this;
  });

  trigger(event: string, ...args: unknown[]): void {
    const handlers = [...(this.listeners.get(event) ?? [])];
    for (const fn of handlers) {
      fn(...args);
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

let activeSocket: MockSocket;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    activeSocket = new MockSocket();
    return activeSocket;
  }),
}));

import {
  connectSignaling,
  createRoom,
  joinRoom,
  rejoinRoom,
  confirmPeerConnected,
  notifyPeerConnected,
  leaveRoom,
  resolveServerUrl,
  getSocket,
  resetSignalingSocketForTests,
} from '../signaling';

describe('signaling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSignalingSocketForTests();
  });

  afterEach(() => {
    resetSignalingSocketForTests();
    vi.useRealTimers();
  });

  it('validates signaling server origin, requiring TLS for non-loopback hosts', () => {
    expect(resolveServerUrl(undefined)).toBe('http://localhost:3001');
    expect(resolveServerUrl('http://localhost:3001')).toBe('http://localhost:3001');
    expect(resolveServerUrl('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
    expect(resolveServerUrl('http://[::1]:3001')).toBe('http://[::1]:3001');
    expect(resolveServerUrl('https://signal.example.com')).toBe('https://signal.example.com');
    expect(resolveServerUrl('HTTPS://SIGNAL.EXAMPLE.COM')).toBe('https://signal.example.com');
    expect(resolveServerUrl('WSS://SIGNAL.EXAMPLE.COM/belote?v=1')).toBe(
      'wss://signal.example.com/belote?v=1',
    );
    expect(resolveServerUrl('wss://signal.example.com')).toBe('wss://signal.example.com');
    expect(() => resolveServerUrl('http://signal.example.com')).toThrow(/must use https/i);
    expect(() => resolveServerUrl('ws://signal.example.com')).toThrow(/must use https/i);
    expect(() => resolveServerUrl('ftp://signal.example.com')).toThrow(
      /Unsupported signaling server protocol/i,
    );
    expect(() => resolveServerUrl('javascript:alert(1)')).toThrow(
      /Unsupported signaling server protocol/i,
    );
    expect(() => resolveServerUrl('not-a-url')).toThrow(/Invalid signaling server URL/i);
  });

  it('normalizes schemeless hostnames and protocol-relative URLs', () => {
    expect(resolveServerUrl('belote-server.bwieder.com')).toBe(
      'https://belote-server.bwieder.com',
    );
    expect(resolveServerUrl('BELOTE-SERVER.BWIEDER.COM/')).toBe(
      'https://belote-server.bwieder.com',
    );
    expect(resolveServerUrl('belote-server.bwieder.com:8443/signal?v=1')).toBe(
      'https://belote-server.bwieder.com:8443/signal?v=1',
    );
    expect(resolveServerUrl('//belote-server.bwieder.com')).toBe(
      'https://belote-server.bwieder.com',
    );
    expect(resolveServerUrl('localhost:3001')).toBe('http://localhost:3001');
    expect(resolveServerUrl('localhost:443')).toBe('http://localhost:443');
    expect(resolveServerUrl('127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
    expect(resolveServerUrl('[::1]:3001')).toBe('http://[::1]:3001');
    expect(() => resolveServerUrl('/relative/path')).toThrow(/Invalid signaling server URL/i);
    expect(() => resolveServerUrl('///belote-server.bwieder.com')).toThrow(
      /Invalid signaling server URL/i,
    );
    expect(() => resolveServerUrl('.example.com')).toThrow(/Invalid signaling server URL/i);
    expect(() => resolveServerUrl('bad..example.com')).toThrow(/Invalid signaling server URL/i);
    expect(() => resolveServerUrl('user@belote-server.bwieder.com')).toThrow(
      /Invalid signaling server URL/i,
    );
    expect(() => resolveServerUrl('belote-server.bwieder.com extra')).toThrow(
      /Invalid signaling server URL/i,
    );
  });

  it('connectSignaling resolves immediately when already connected', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    await expect(connectSignaling(500)).resolves.toBeUndefined();
    expect(sock.connect).not.toHaveBeenCalled();
  });

  it('connectSignaling cleans up both connect and connect_error handlers on resolve', async () => {
    const sock = getSocket() as unknown as MockSocket;
    const unrelatedConnect = vi.fn();
    sock.on('connect', unrelatedConnect);

    const promise = connectSignaling(1_000);
    expect(sock.listenerCount('connect')).toBe(2);
    expect(sock.listenerCount('connect_error')).toBe(1);

    sock.connected = true;
    sock.trigger('connect');
    await expect(promise).resolves.toBeUndefined();

    expect(sock.listenerCount('connect')).toBe(1);
    expect(sock.listenerCount('connect_error')).toBe(0);
    expect(unrelatedConnect).toHaveBeenCalledTimes(1);
  });

  it('connectSignaling cleans up listeners on connect_error', async () => {
    const sock = getSocket() as unknown as MockSocket;
    const promise = connectSignaling(1_000);

    sock.trigger('connect_error', new Error('refused'));
    await expect(promise).rejects.toThrow('refused');

    expect(sock.listenerCount('connect')).toBe(0);
    expect(sock.listenerCount('connect_error')).toBe(0);
  });

  it('connectSignaling cleans up only its own listeners on timeout', async () => {
    const sock = getSocket() as unknown as MockSocket;
    const unrelated = vi.fn();
    sock.on('connect', unrelated);

    const promise = connectSignaling(500);
    vi.advanceTimersByTime(500);

    await expect(promise).rejects.toThrow('Connection to signaling server timed out');
    expect(sock.listenerCount('connect')).toBe(1);
    expect(sock.listenerCount('connect_error')).toBe(0);
  });

  it('createRoom uses socket.timeout and resolves with code and reconnectToken', async () => {
    const sock = getSocket() as unknown as MockSocket;
    const promise = createRoom(1_000);

    expect(sock.timeout).toHaveBeenCalledWith(1_000);
    expect(sock.listenerCount('disconnect')).toBe(1);
    const payload = sock.emitted[0].args[0] as { attemptId: string };
    expect(payload.attemptId).toBeTruthy();
    const ack = sock.emitted[0].args[1] as (data: { code: string; reconnectToken: string }) => void;
    ack({ code: 'ABCD', reconnectToken: 'tok-host' });

    await expect(promise).resolves.toEqual({ code: 'ABCD', reconnectToken: 'tok-host' });
    expect(sock.listenerCount('disconnect')).toBe(0);
  });

  it('createRoom scopes timeout cleanup by attemptId and skips cleanup when superseded by a newer create', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;
    const promise = createRoom(250);
    const payloadA = sock.emitted[0].args[0] as { attemptId: string };

    const beforeTimeout = sock.emitted.length;
    vi.advanceTimersByTime(250);
    await expect(promise).rejects.toThrow('Creating room timed out');
    expect(sock.listenerCount('disconnect')).toBe(0);
    expect(sock.emitted.slice(beforeTimeout)).toEqual([
      { event: 'leave-room', args: [{ createAttemptId: payloadA.attemptId }] },
    ]);

    // Overlapping createRoom B supersedes timed-out createRoom A -> A emits no leave-room
    const firstOverlap = createRoom(250);
    const secondOverlap = createRoom(1_000);
    const secondAck = sock.emitted[sock.emitted.length - 1].args[1] as (data: {
      code: string;
      reconnectToken: string;
    }) => void;

    const beforeFirstTimeout = sock.emitted.length;
    vi.advanceTimersByTime(250);
    await expect(firstOverlap).rejects.toThrow('Creating room timed out');
    expect(sock.emitted.slice(beforeFirstTimeout)).toEqual([]);

    secondAck({ code: 'NEW1', reconnectToken: 'tok-new1' });
    await expect(secondOverlap).resolves.toEqual({ code: 'NEW1', reconnectToken: 'tok-new1' });
  });

  it('createRoom rejects if socket disconnects before ack', async () => {
    const sock = getSocket() as unknown as MockSocket;
    const promise = createRoom(1_000);

    sock.trigger('disconnect');
    await expect(promise).rejects.toThrow('Disconnected while creating room');
    expect(sock.listenerCount('disconnect')).toBe(0);
  });

  it('createRoom rejects when server returns an error callback', async () => {
    const sock = getSocket() as unknown as MockSocket;
    const promise = createRoom(1_000);

    const ack = sock.emitted[0].args[1] as (data: { error?: string }) => void;
    ack({ error: 'Unable to create room. Server is at capacity.' });

    await expect(promise).rejects.toThrow('Unable to create room. Server is at capacity.');
    expect(sock.listenerCount('disconnect')).toBe(0);
  });

  it('joinRoom scopes cancel-join to the timed-out attempt, ignores late acks after retry, and confirms timely joins', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    // Attempt A times out
    const timedOutA = joinRoom('ABCD', 200);
    const emitA = sock.emitted[sock.emitted.length - 1];
    expect(emitA.event).toBe('join-room');
    expect(emitA.timeoutMs).toBe(200);
    const payloadA = emitA.args[0] as { code: string; attemptId: string };
    expect(payloadA.code).toBe('ABCD');
    const lateAckA = emitA.args[1] as (data: { success: boolean; reconnectToken?: string }) => void;

    const beforeTimeout = sock.emitted.length;
    vi.advanceTimersByTime(200);
    await expect(timedOutA).rejects.toThrow('Joining room timed out');
    expect(sock.listenerCount('disconnect')).toBe(0);
    expect(sock.emitted.slice(beforeTimeout)).toEqual([
      { event: 'cancel-join', args: [{ code: 'ABCD', attemptId: payloadA.attemptId }] },
    ]);

    // Late ACK arriving after Socket.IO transport timeout is dropped by transport (adds no events)
    const beforeLateAck = sock.emitted.length;
    lateAckA({ success: true, reconnectToken: 'late-tok-a' });
    expect(sock.emitted.slice(beforeLateAck)).toEqual([]);

    // Start newer attempt B for the SAME room; attempt B gets a distinct attemptId and confirms cleanly
    const joinedB = joinRoom('ABCD', 1_000);
    const emitB = sock.emitted[sock.emitted.length - 1];
    expect(emitB.event).toBe('join-room');
    const payloadB = emitB.args[0] as { code: string; attemptId: string };
    expect(payloadB.attemptId).not.toBe(payloadA.attemptId);

    const ackB = emitB.args[1] as (data: { success: boolean; reconnectToken: string }) => void;
    const beforeAckB = sock.emitted.length;
    ackB({ success: true, reconnectToken: 'tok-guest-b' });

    await expect(joinedB).resolves.toEqual({ success: true, reconnectToken: 'tok-guest-b' });
    expect(sock.emitted.slice(beforeAckB)).toEqual([
      { event: 'confirm-join', args: [{ code: 'ABCD', attemptId: payloadB.attemptId }] },
    ]);
    expect(sock.listenerCount('disconnect')).toBe(0);
  });

  it('rejoinRoom forwards passive/retry options, uses socket.timeout, and notifyPeerConnected emits peer-connected', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    const promise = rejoinRoom('ABCD', 'guest', 'tok-guest', 1_000, { retry: true });
    const emit = sock.emitted[0];
    expect(emit.event).toBe('rejoin-room');
    expect(emit.timeoutMs).toBe(1_000);
    expect(emit.args[0]).toEqual({
      code: 'ABCD',
      role: 'guest',
      token: 'tok-guest',
      retry: true,
    });
    const ack = emit.args[1] as (data: { success: boolean; peerPresent: boolean }) => void;
    ack({ success: true, peerPresent: true });
    await expect(promise).resolves.toEqual({ success: true, peerPresent: true });

    const passivePromise = rejoinRoom('ABCD', 'host', 'tok-host', 1_000, { passive: true });
    const passiveEmit = sock.emitted[sock.emitted.length - 1];
    expect(passiveEmit.args[0]).toEqual({
      code: 'ABCD',
      role: 'host',
      token: 'tok-host',
      passive: true,
    });
    (passiveEmit.args[1] as (data: { success: boolean }) => void)({ success: true });
    await expect(passivePromise).resolves.toEqual({ success: true });

    const timedOut = rejoinRoom('ABCD', 'host', 'tok-host', 300);
    vi.advanceTimersByTime(300);
    await expect(timedOut).rejects.toThrow('Rejoining room timed out');

    const dropped = rejoinRoom('ABCD', 'host', 'tok-host', 1_000);
    sock.trigger('disconnect');
    await expect(dropped).rejects.toThrow('Disconnected while rejoining room');

    sock.connected = true;
    notifyPeerConnected('ABCD', 2);
    expect(sock.emitted[sock.emitted.length - 1]).toEqual({
      event: 'peer-connected',
      args: [{ code: 'ABCD', negotiationId: 2 }],
    });

    const confirmPromise = confirmPeerConnected('ABCD', 0, 1_000);
    const confirmEmit = sock.emitted[sock.emitted.length - 1];
    expect(confirmEmit.event).toBe('peer-connected');
    expect(confirmEmit.args[0]).toEqual({ code: 'ABCD', negotiationId: 0 });
    (confirmEmit.args[1] as (res: { ok: boolean }) => void)({ ok: true });
    await expect(confirmPromise).resolves.toBe('confirmed');

    const rejectPromise = confirmPeerConnected('ABCD', 0, 1_000);
    const rejectEmit = sock.emitted[sock.emitted.length - 1];
    (rejectEmit.args[1] as (res: { ok: boolean }) => void)({ ok: false });
    await expect(rejectPromise).resolves.toBe('rejected');

    sock.connected = false;
    await expect(confirmPeerConnected('ABCD', 0, 1_000)).resolves.toBe('ambiguous');

    // Leaving while offline queues a token-authenticated leave-room flushed on next connect
    sock.connected = false;
    const beforeOfflineLeave = sock.emitted.length;
    leaveRoom({ code: 'ABCD', role: 'guest', token: 'tok-guest' });
    expect(sock.emitted.slice(beforeOfflineLeave)).toEqual([]);

    sock.connected = true;
    sock.trigger('connect');
    const flushedLeaves = sock.emitted.slice(beforeOfflineLeave);
    expect(flushedLeaves).toHaveLength(1);
    expect(flushedLeaves[0].event).toBe('leave-room');
    expect(flushedLeaves[0].args[0]).toEqual({
      code: 'ABCD',
      role: 'guest',
      token: 'tok-guest',
    });
    (flushedLeaves[0].args[1] as (ack: { ok: boolean }) => void)({ ok: true });
  });

  it('keeps credentialed leave-room pending across timeout until ACKed, then disconnects if requested', () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    leaveRoom(
      { code: 'ABCD', role: 'host', token: 'tok-host' },
      { disconnectAfter: true },
    );

    // Must not disconnect before the server ACKs closure
    expect(sock.disconnect).not.toHaveBeenCalled();
    expect(sock.emitted).toHaveLength(1);
    expect(sock.emitted[0].event).toBe('leave-room');
    expect(sock.emitted[0].args[0]).toEqual({
      code: 'ABCD',
      role: 'host',
      token: 'tok-host',
    });

    // First attempt times out -> retries after backoff without disconnecting prematurely
    vi.advanceTimersByTime(3_000);
    expect(sock.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(sock.emitted).toHaveLength(2);
    expect(sock.emitted[1].event).toBe('leave-room');

    // Second attempt is ACKed -> pending leave clears and socket disconnects
    (sock.emitted[1].args[1] as (ack: { ok: boolean }) => void)({ ok: true });
    expect(sock.disconnect).toHaveBeenCalledTimes(1);
  });

  it('initiates bounded delivery for offline departures and disconnects on deadline expiry', () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = false;

    leaveRoom(
      { code: 'OFF1', role: 'guest', token: 'tok-off' },
      { disconnectAfter: true },
    );

    // Immediately initiates a reconnect attempt to flush the departure
    expect(sock.connect).toHaveBeenCalledTimes(1);
    expect(sock.listenerCount('connect')).toBe(1);

    // Moving the system clock backwards by an hour must NOT extend the 10-second monotonic deadline
    vi.setSystemTime(Date.now() - 3_600_000);

    // If signaling never returns before the delivery deadline, expires entry, cleans listeners, and stops reconnects
    vi.advanceTimersByTime(10_000);
    expect(sock.listenerCount('connect')).toBe(0);
    expect(sock.listenerCount('disconnect')).toBe(0);
    expect(sock.disconnect).toHaveBeenCalledTimes(1);

    // A later reconnect after expiry must NOT deliver the expired leave-room packet
    const beforeLateConnect = sock.emitted.length;
    sock.connected = true;
    sock.trigger('connect');
    expect(sock.emitted.slice(beforeLateConnect)).toEqual([]);

    // Emitting near the remaining delivery deadline caps the Socket.IO transport timeout to remaining budget
    sock.connected = false;
    leaveRoom({ code: 'CAP1', role: 'guest', token: 'tok-cap' });
    vi.advanceTimersByTime(9_200);
    sock.timeout.mockClear();
    sock.connected = true;
    sock.trigger('connect');
    expect(sock.timeout).toHaveBeenCalledTimes(1);
    expect(sock.timeout.mock.calls[0][0]).toBeLessThanOrEqual(800);
    // Expire the remaining 800ms so the entry cleans up
    vi.advanceTimersByTime(1_000);

    // Cancelling without room credentials while offline still calls disconnect() to stop auto-reconnect
    sock.connected = false;
    sock.disconnect.mockClear();
    leaveRoom(undefined, { disconnectAfter: true });
    expect(sock.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cleans up late successful acknowledgements arriving after a disconnect rejection before timeout', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    // 1. Abandoned join-room: disconnect rejects caller, socket reconnects before timeout, late ACK arrives
    const abandonedJoin = joinRoom('ABCD', 5_000);
    const joinEmit = sock.emitted[sock.emitted.length - 1];
    const joinPayload = joinEmit.args[0] as { code: string; attemptId: string };
    const joinLateAck = joinEmit.args[1] as (data: { success: boolean; reconnectToken?: string }) => void;

    sock.connected = false;
    sock.trigger('disconnect');
    await expect(abandonedJoin).rejects.toThrow('Disconnected while joining room');

    // Socket reconnects before transport timeout and buffered join-room ACK returns success
    sock.connected = true;
    const beforeJoinCleanup = sock.emitted.length;
    joinLateAck({ success: true, reconnectToken: 'abandoned-guest-tok' });
    expect(sock.emitted.slice(beforeJoinCleanup)).toEqual([
      { event: 'cancel-join', args: [{ code: 'ABCD', attemptId: joinPayload.attemptId }] },
    ]);

    // 2. Abandoned create-room: late success cleans up only that room via its reconnectToken
    const abandonedCreate = createRoom(5_000);
    const createEmit = sock.emitted[sock.emitted.length - 1];
    const createLateAck = createEmit.args[1] as (data: { code?: string; reconnectToken?: string }) => void;

    sock.connected = false;
    sock.trigger('disconnect');
    await expect(abandonedCreate).rejects.toThrow('Disconnected while creating room');

    sock.connected = true;
    const beforeCreateCleanup = sock.emitted.length;
    createLateAck({ code: 'ABND', reconnectToken: 'abandoned-host-tok' });
    expect(sock.emitted.slice(beforeCreateCleanup)).toEqual([
      {
        event: 'leave-room',
        args: [{ code: 'ABND', role: 'host', token: 'abandoned-host-tok' }],
      },
    ]);
  });

  it('emits scoped cancel-join instead of confirm-join when isCurrent returns false on join ACK', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    let current = true;
    const joinPromise = joinRoom('ABCD', 5_000, () => current);
    const joinEmit = sock.emitted[sock.emitted.length - 1];
    const joinPayload = joinEmit.args[0] as { code: string; attemptId: string };
    const ack = joinEmit.args[1] as (data: { success: boolean; reconnectToken?: string }) => void;

    // Session moves on before ACK arrives
    current = false;
    const beforeAck = sock.emitted.length;
    ack({ success: true, reconnectToken: 'stale-tok' });
    await joinPromise;

    expect(sock.emitted.slice(beforeAck)).toEqual([
      { event: 'cancel-join', args: [{ code: 'ABCD', attemptId: joinPayload.attemptId }] },
    ]);
  });

  it('runs attempt-scoped cancel-join when a buffered join-room abandoned on disconnect later times out after reconnect', async () => {
    const sock = getSocket() as unknown as MockSocket;
    sock.connected = true;

    let capturedTimeoutCb: ((err: Error | null, data?: unknown) => void) | undefined;
    let capturedPayload: { code: string; attemptId: string } | undefined;
    sock.timeout.mockImplementationOnce(() => ({
      emit: (_event: string, ...args: unknown[]) => {
        capturedPayload = args[0] as { code: string; attemptId: string };
        capturedTimeoutCb = args[1] as (err: Error | null, data?: unknown) => void;
        return sock;
      },
    }));

    const abandonedJoin = joinRoom('TIME', 5_000);
    sock.connected = false;
    sock.trigger('disconnect');
    await expect(abandonedJoin).rejects.toThrow('Disconnected while joining room');

    // Socket reconnects and transport timeout fires for the buffered join-room packet
    sock.connected = true;
    const beforeTimeout = sock.emitted.length;
    capturedTimeoutCb?.(new Error('operation has timed out'));

    expect(sock.emitted.slice(beforeTimeout)).toEqual([
      { event: 'cancel-join', args: [{ code: 'TIME', attemptId: capturedPayload!.attemptId }] },
    ]);
  });
});

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server, Socket } from 'socket.io';
import { setupSignaling } from '../signaling.js';
import {
  clearRooms,
  createRoom,
  getRoom,
  getRoomCount,
  MAX_ROOMS,
  stopRoomCleanup,
} from '../rooms.js';
import { createSignalingServer, parseAllowedOrigins } from '../index.js';

type EventHandler = (...args: unknown[]) => void;

interface EmittedEvent {
  target: string;
  event: string;
  payload: unknown;
}

class MockSocket {
  id: string;
  joinedRooms = new Set<string>();
  private handlers = new Map<string, EventHandler>();

  constructor(id: string) {
    this.id = id;
  }

  on(event: string, handler: EventHandler): this {
    this.handlers.set(event, handler);
    return this;
  }

  join(room: string): void {
    this.joinedRooms.add(room);
  }

  leave(room: string): void {
    this.joinedRooms.delete(room);
  }

  trigger(event: string, ...args: unknown[]): void {
    const handler = this.handlers.get(event);
    assert.ok(handler, `No handler registered for "${event}"`);
    handler(...args);
  }
}

class MockIo {
  emitted: EmittedEvent[] = [];
  private sockets: MockSocket[] = [];
  private connectionHandler: ((socket: Socket) => void) | null = null;

  on(event: string, handler: (socket: Socket) => void): this {
    if (event === 'connection') {
      this.connectionHandler = handler;
    }
    return this;
  }

  to(target: string): { emit: (event: string, payload?: unknown) => void } {
    return {
      emit: (event: string, payload?: unknown) => {
        this.emitted.push({ target, event, payload });
      },
    };
  }

  in(room: string): { socketsLeave: (targetRoom: string) => void } {
    return {
      socketsLeave: (targetRoom: string) => {
        for (const s of this.sockets) {
          if (s.joinedRooms.has(room)) {
            s.leave(targetRoom);
          }
        }
      },
    };
  }

  connect(socket: MockSocket): void {
    assert.ok(this.connectionHandler, 'setupSignaling must register connection');
    this.sockets.push(socket);
    this.connectionHandler(socket as unknown as Socket);
  }
}

describe('signaling', () => {
  let io: MockIo;

  beforeEach(() => {
    clearRooms();
    io = new MockIo();
    setupSignaling(io as unknown as Server);
  });

  after(() => {
    clearRooms();
    stopRoomCleanup();
  });

  it('creates a room with reconnectToken and cleans up any previous room for the same socket', () => {
    const host = new MockSocket('host-1');
    const guest = new MockSocket('guest-1');
    io.connect(host);
    io.connect(guest);

    let firstCode = '';
    let hostToken = '';
    host.trigger(
      'create-room',
      (res: { code?: string; reconnectToken?: string; error?: string }) => {
        assert.ok(res.code);
        assert.ok(res.reconnectToken);
        assert.equal(res.error, undefined);
        firstCode = res.code;
        hostToken = res.reconnectToken;
      },
    );
    assert.ok(hostToken.length > 0);
    assert.equal(getRoomCount(), 1);
    assert.ok(host.joinedRooms.has(firstCode));

    guest.trigger(
      'join-room',
      firstCode,
      (res: { success: boolean; reconnectToken?: string; error?: string }) => {
        assert.equal(res.success, true);
        assert.ok(res.reconnectToken);
      },
    );

    // Creating a second room from the same host cleans up the first room
    let secondCode = '';
    host.trigger('create-room', (res: { code?: string; error?: string }) => {
      assert.ok(res.code);
      secondCode = res.code;
    });

    assert.equal(getRoomCount(), 1);
    assert.equal(getRoom(firstCode), null);
    assert.ok(getRoom(secondCode));
    assert.equal(host.joinedRooms.has(firstCode), false);
    assert.equal(guest.joinedRooms.has(firstCode), false);
    assert.equal(host.joinedRooms.has(secondCode), true);
    assert.ok(
      io.emitted.some(
        (e) =>
          e.target === 'guest-1' &&
          e.event === 'peer-disconnected' &&
          (e.payload as { preserved?: boolean })?.preserved === false,
      ),
    );
  });

  it('returns an error callback when create-room hits server room capacity', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < MAX_ROOMS; i++) {
      const code =
        chars[Math.floor(i / (32 * 32)) % 32] +
        chars[Math.floor(i / 32) % 32] +
        chars[i % 32] +
        'A';
      createRoom(`existing-${i}`, { codeGenerator: () => code });
    }
    assert.equal(getRoomCount(), MAX_ROOMS);

    const host = new MockSocket('overflow-host');
    io.connect(host);

    let response: { code?: string; error?: string } | null = null;
    host.trigger('create-room', (res: { code?: string; error?: string }) => {
      response = res;
    });

    assert.ok(response);
    assert.equal((response as { code?: string; error?: string }).code, undefined);
    assert.ok((response as { code?: string; error?: string }).error);
  });

  it('validates join-room inputs without crashing on malformed payloads', () => {
    const guest = new MockSocket('guest-1');
    io.connect(guest);

    const invalidInputs: unknown[] = [
      null,
      undefined,
      1234,
      {},
      ['ABCD'],
      '',
      'ABC',
      'ABCDE',
      'AB$D',
      { code: 'ABCD', attemptId: 123 },
      { code: 'ABCD', attemptId: '' },
    ];

    for (const input of invalidInputs) {
      let response: { success: boolean; error?: string } | null = null;
      guest.trigger(
        'join-room',
        input,
        (res: { success: boolean; error?: string }) => {
          response = res;
        },
      );
      assert.deepEqual(response, {
        success: false,
        error: 'Invalid room code',
      });
    }
  });

  it('prevents a socket from joining its own room', () => {
    const host = new MockSocket('host-1');
    io.connect(host);

    let code = '';
    host.trigger('create-room', (res: { code?: string }) => {
      code = res.code ?? '';
    });

    let joinRes: { success: boolean; error?: string } | null = null;
    host.trigger(
      'join-room',
      code,
      (res: { success: boolean; error?: string }) => {
        joinRes = res;
      },
    );

    assert.deepEqual(joinRes, {
      success: false,
      error: 'Room not found or full',
    });
    assert.equal(
      io.emitted.some((e) => e.event === 'peer-joined'),
      false,
    );
  });

  it('releases guest slot and notifies host on cancel-join and provisional disconnect', () => {
    const host = new MockSocket('host-1');
    const guest = new MockSocket('guest-1');
    const guest2 = new MockSocket('guest-2');
    io.connect(host);
    io.connect(guest);
    io.connect(guest2);

    let code = '';
    host.trigger('create-room', (res: { code?: string }) => {
      code = res.code ?? '';
    });
    guest.trigger('join-room', { code, attemptId: 'a1' });
    assert.equal(getRoom(code)?.guestSocketId, 'guest-1');

    // Mismatched or malformed attemptId is ignored without dropping attempt scope
    guest.trigger('cancel-join', { code, attemptId: 'stale' });
    assert.equal(getRoom(code)?.guestSocketId, 'guest-1');
    guest.trigger('cancel-join', { code, attemptId: 1 });
    assert.equal(getRoom(code)?.guestSocketId, 'guest-1');
    guest.trigger('cancel-join', { code, attemptId: '' });
    assert.equal(getRoom(code)?.guestSocketId, 'guest-1');

    // Matching attemptId cancels cleanly
    guest.trigger('cancel-join', { code, attemptId: 'a1' });
    assert.equal(getRoom(code)?.guestSocketId, null);
    assert.equal(getRoom(code)?.hasStarted, false);
    assert.equal(guest.joinedRooms.has(code), false);
    assert.ok(
      io.emitted.some(
        (e) => e.target === 'host-1' && e.event === 'peer-join-cancelled',
      ),
    );

    // Provisional guest disconnecting before confirm-join also releases slot cleanly
    guest2.trigger('join-room', { code, attemptId: 'a2' });
    guest2.trigger('disconnect');
    assert.equal(getRoom(code)?.guestSocketId, null);
    assert.equal(getRoom(code)?.hasStarted, false);
  });

  it('validates signal payloads and only relays between room members', () => {
    const host = new MockSocket('host-1');
    const guest = new MockSocket('guest-1');
    const intruder = new MockSocket('intruder-1');
    io.connect(host);
    io.connect(guest);
    io.connect(intruder);

    let code = '';
    host.trigger('create-room', (res: { code?: string }) => {
      code = res.code ?? '';
    });
    guest.trigger('join-room', ` ${code.toLowerCase()} `);

    // Malformed signal payloads are ignored without throwing
    const malformedSignals: unknown[] = [
      null,
      undefined,
      'string',
      123,
      [],
      {},
      { roomCode: 1234, signal: { sdp: 'x' } },
      { roomCode: code },
      { roomCode: code, signal: undefined },
    ];
    for (const payload of malformedSignals) {
      host.trigger('signal', payload);
    }
    assert.equal(
      io.emitted.some((e) => e.event === 'signal'),
      false,
    );

    // Non-member cannot relay into the room
    intruder.trigger('signal', { roomCode: code, signal: { type: 'offer' } });
    assert.equal(
      io.emitted.some((e) => e.event === 'signal'),
      false,
    );

    // Host -> guest relay works
    host.trigger('signal', { roomCode: code, signal: { type: 'offer' } });
    assert.deepEqual(io.emitted.at(-1), {
      target: 'guest-1',
      event: 'signal',
      payload: { roomCode: code, signal: { type: 'offer' }, from: 'host-1' },
    });

    // Guest -> host relay works
    guest.trigger('signal', { roomCode: code, signal: { type: 'answer' } });
    assert.deepEqual(io.emitted.at(-1), {
      target: 'host-1',
      event: 'signal',
      payload: { roomCode: code, signal: { type: 'answer' }, from: 'guest-1' },
    });
  });

  it('preserves active room on unexpected disconnect and allows rejoin-room', () => {
    const host = new MockSocket('host-1');
    const guest = new MockSocket('guest-1');
    const hostRejoined = new MockSocket('host-2');
    io.connect(host);
    io.connect(guest);
    io.connect(hostRejoined);

    let code = '';
    let hostToken = '';
    host.trigger('create-room', (res: { code?: string; reconnectToken?: string }) => {
      code = res.code ?? '';
      hostToken = res.reconnectToken ?? '';
    });
    guest.trigger('join-room', code);
    guest.trigger('confirm-join', code);
    let hostPrematureAck: { ok: boolean } | null = null;
    host.trigger('peer-connected', { code, negotiationId: 0 }, (res: { ok: boolean }) => {
      hostPrematureAck = res;
    });
    assert.deepEqual(hostPrematureAck, { ok: false });

    let guestStartAck: { ok: boolean } | null = null;
    guest.trigger('peer-connected', { code, negotiationId: 0 }, (res: { ok: boolean }) => {
      guestStartAck = res;
    });
    assert.deepEqual(guestStartAck, { ok: true });

    // Unexpected disconnect preserves confirmed room during grace window
    host.trigger('disconnect');
    assert.ok(getRoom(code));
    assert.equal(getRoom(code)?.hostSocketId, null);
    assert.ok(
      io.emitted.some(
        (e) =>
          e.target === 'guest-1' &&
          e.event === 'peer-disconnected' &&
          (e.payload as { preserved?: boolean })?.preserved === true,
      ),
    );

    // Host rejoins with valid token -> guest gets peer-reconnected with negotiationId
    let rejoinRes: {
      success: boolean;
      role?: string;
      peerPresent?: boolean;
      alreadyNegotiating?: boolean;
      negotiationId?: number;
    } | null = null;
    hostRejoined.trigger(
      'rejoin-room',
      { code, role: 'host', token: hostToken },
      (res: {
        success: boolean;
        role?: string;
        peerPresent?: boolean;
        alreadyNegotiating?: boolean;
        negotiationId?: number;
      }) => {
        rejoinRes = res;
      },
    );
    assert.deepEqual(rejoinRes, {
      success: true,
      role: 'host',
      peerPresent: true,
      alreadyNegotiating: false,
      negotiationId: 1,
    });
    assert.ok(
      io.emitted.some(
        (e) =>
          e.target === 'guest-1' &&
          e.event === 'peer-reconnected' &&
          (e.payload as { negotiationId?: number })?.negotiationId === 1,
      ),
    );

    // Passive rejoin restores seat without emitting peer-reconnected
    const emittedBeforePassive = io.emitted.length;
    let passiveRes: { success: boolean; alreadyNegotiating?: boolean } | null = null;
    hostRejoined.trigger(
      'rejoin-room',
      { code, role: 'host', token: hostToken, passive: true },
      (res: { success: boolean; alreadyNegotiating?: boolean }) => {
        passiveRes = res;
      },
    );
    assert.equal((passiveRes as { success: boolean } | null)?.success, true);
    assert.equal(io.emitted.slice(emittedBeforePassive).length, 0);

    // After peer-connected with matching negotiationId clears dedupe, a subsequent rejoin starts negotiation #2
    hostRejoined.trigger('peer-connected', { code, negotiationId: 1 });
    let secondRes: { success: boolean; alreadyNegotiating?: boolean; negotiationId?: number } | null = null;
    hostRejoined.trigger(
      'rejoin-room',
      { code, role: 'host', token: hostToken },
      (res: { success: boolean; alreadyNegotiating?: boolean; negotiationId?: number }) => {
        secondRes = res;
      },
    );
    assert.equal((secondRes as { alreadyNegotiating?: boolean } | null)?.alreadyNegotiating, false);
    assert.equal((secondRes as { negotiationId?: number } | null)?.negotiationId, 2);

    // Token-authenticated leave-room from an unbound socket closes the room and notifies opponent
    const hostFreshSocket = new MockSocket('host-3');
    io.connect(hostFreshSocket);
    hostFreshSocket.trigger('leave-room', { code, role: 'host', token: hostToken });
    assert.equal(getRoom(code), null);
    assert.ok(
      io.emitted.some(
        (e) =>
          e.target === 'guest-1' &&
          e.event === 'peer-disconnected' &&
          (e.payload as { preserved?: boolean })?.preserved === false,
      ),
    );
  });

  it('deletes room immediately and removes remaining members on explicit leave-room', () => {
    const host = new MockSocket('host-1');
    const guest = new MockSocket('guest-1');
    io.connect(host);
    io.connect(guest);

    let code = '';
    host.trigger('create-room', (res: { code?: string }) => {
      code = res.code ?? '';
    });
    guest.trigger('join-room', code);
    assert.equal(guest.joinedRooms.has(code), true);

    host.trigger('leave-room');
    assert.equal(getRoom(code), null);
    assert.equal(guest.joinedRooms.has(code), false);
    assert.ok(
      io.emitted.some(
        (e) =>
          e.target === 'guest-1' &&
          e.event === 'peer-disconnected' &&
          (e.payload as { preserved?: boolean })?.preserved === false,
      ),
    );
  });

  it('scopes token-authenticated leave-room to the abandoned room without closing a retry-created room', () => {
    const host = new MockSocket('host-retry');
    io.connect(host);

    let codeA = '';
    let tokenA = '';
    host.trigger('create-room', (res: { code?: string; reconnectToken?: string }) => {
      codeA = res.code ?? '';
      tokenA = res.reconnectToken ?? '';
    });

    let codeB = '';
    let tokenB = '';
    for (let attempt = 0; attempt < 5 && (!codeB || codeB === codeA); attempt++) {
      let createdCode = '';
      let createdToken = '';
      host.trigger('create-room', (res: { code?: string; reconnectToken?: string; error?: string }) => {
        assert.equal(res.error, undefined);
        assert.ok(res.code);
        assert.ok(res.reconnectToken);
        createdCode = res.code;
        createdToken = res.reconnectToken;
      });
      codeB = createdCode;
      tokenB = createdToken;
    }
    assert.ok(codeB);
    assert.notEqual(codeB, codeA);
    assert.equal(getRoom(codeA), null);
    assert.equal(getRoom(codeB)?.hostToken, tokenB);

    // Late cleanup targeting abandoned room A must leave retry-created room B open
    // and acknowledge `{ ok: true }` because room A is already gone.
    let leaveAckA: { ok: boolean } | null = null;
    host.trigger(
      'leave-room',
      { code: codeA, role: 'host', token: tokenA },
      (res: { ok: boolean }) => {
        leaveAckA = res;
      },
    );
    assert.equal(getRoom(codeB)?.hostToken, tokenB);
    assert.equal(host.joinedRooms.has(codeB), true);
    assert.deepEqual(leaveAckA, { ok: true });

    // Malformed scoped leave-room payload must not fall through to closing room B
    host.trigger('leave-room', { code: codeB });
    assert.equal(getRoom(codeB)?.hostToken, tokenB);

    // Scoped createAttemptId cleanup closes only a matching attempt and preserves a newer attempt
    host.trigger('create-room', { attemptId: 'create-1' }, () => {});
    let codeAttempt2 = '';
    let tokenAttempt2 = '';
    host.trigger(
      'create-room',
      { attemptId: 'create-2' },
      (res: { code?: string; reconnectToken?: string }) => {
        codeAttempt2 = res.code ?? '';
        tokenAttempt2 = res.reconnectToken ?? '';
      },
    );
    assert.equal(getRoom(codeAttempt2)?.hostToken, tokenAttempt2);

    host.trigger('leave-room', { createAttemptId: 'create-1' });
    assert.equal(getRoom(codeAttempt2)?.hostToken, tokenAttempt2);

    host.trigger('leave-room', { createAttemptId: 'create-2' });
    assert.equal(getRoom(codeAttempt2), null);
  });
});

describe('HTTP endpoints and CORS configuration', () => {
  it('parses single, comma-separated, and empty CLIENT_URL values', () => {
    assert.equal(parseAllowedOrigins(undefined), 'http://localhost:5173');
    assert.equal(parseAllowedOrigins('   '), 'http://localhost:5173');
    assert.equal(
      parseAllowedOrigins('https://belote.example.com'),
      'https://belote.example.com',
    );
    assert.deepEqual(
      parseAllowedOrigins(' https://a.com , https://b.com , '),
      ['https://a.com', 'https://b.com'],
    );
  });

  it('serves /health, /ice-servers, and comma-separated CORS origins', async () => {
    const { httpServer, io } = createSignalingServer({
      clientUrl: 'https://a.example.com, https://b.example.com',
      getIceServersFn: async () => [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:global.relay.metered.ca:443',
          username: 'u',
          credential: 'p',
        },
      ],
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const { port } = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;

      const healthRes = await fetch(`${baseUrl}/health`, {
        headers: { Origin: 'https://b.example.com' },
      });
      assert.equal(healthRes.status, 200);
      assert.equal(
        healthRes.headers.get('access-control-allow-origin'),
        'https://b.example.com',
      );
      assert.deepEqual(await healthRes.json(), { status: 'ok' });

      const iceRes = await fetch(`${baseUrl}/ice-servers`, {
        headers: { Origin: 'https://a.example.com' },
      });
      assert.equal(iceRes.status, 200);
      assert.equal(iceRes.headers.get('cache-control'), 'no-store');
      assert.equal(
        iceRes.headers.get('access-control-allow-origin'),
        'https://a.example.com',
      );
      const iceBody = (await iceRes.json()) as {
        iceServers: Array<{ urls: string }>;
      };
      assert.equal(iceBody.iceServers.length, 2);
      assert.equal(iceBody.iceServers[1].urls, 'turn:global.relay.metered.ca:443');

      // Disallowed origin does not get CORS header
      const blockedRes = await fetch(`${baseUrl}/ice-servers`, {
        headers: { Origin: 'https://evil.example.com' },
      });
      assert.equal(blockedRes.headers.get('access-control-allow-origin'), null);
    } finally {
      await new Promise<void>((resolve) => {
        io.close(() => {
          if (httpServer.listening) {
            httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      });
    }
  });
});

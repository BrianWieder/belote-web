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

  it('creates a room and cleans up any previous room for the same socket', () => {
    const host = new MockSocket('host-1');
    const guest = new MockSocket('guest-1');
    io.connect(host);
    io.connect(guest);

    let firstCode = '';
    host.trigger('create-room', (res: { code?: string; error?: string }) => {
      assert.ok(res.code);
      assert.equal(res.error, undefined);
      firstCode = res.code;
    });
    assert.equal(getRoomCount(), 1);
    assert.ok(host.joinedRooms.has(firstCode));

    guest.trigger(
      'join-room',
      firstCode,
      (res: { success: boolean; error?: string }) => {
        assert.equal(res.success, true);
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
        (e) => e.target === firstCode && e.event === 'peer-disconnected',
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
      payload: { signal: { type: 'offer' }, from: 'host-1' },
    });

    // Guest -> host relay works
    guest.trigger('signal', { roomCode: code, signal: { type: 'answer' } });
    assert.deepEqual(io.emitted.at(-1), {
      target: 'host-1',
      event: 'signal',
      payload: { signal: { type: 'answer' }, from: 'guest-1' },
    });
  });

  it('notifies the room and cleans up on disconnect', () => {
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

    host.trigger('disconnect');
    assert.equal(getRoom(code), null);
    assert.equal(guest.joinedRooms.has(code), false);
    assert.ok(
      io.emitted.some(
        (e) => e.target === code && e.event === 'peer-disconnected',
      ),
    );
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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type SocketListener = (data: { signal: unknown }) => void;

const { socketListeners, createdPeers, MockPeerInstance } = vi.hoisted(() => {
  const listeners = new Set<SocketListener>();
  const peers: Array<{
    options: unknown;
    receivedSignals: unknown[];
    handlers: Map<string, (...args: unknown[]) => void>;
    destroyed: boolean;
  }> = [];

  class MockPeer {
    readonly options: unknown;
    readonly receivedSignals: unknown[] = [];
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    destroyed = false;

    constructor(options: unknown) {
      this.options = options;
      peers.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    signal(data: unknown) {
      this.receivedSignals.push(data);
    }

    send() {}

    destroy() {
      this.destroyed = true;
    }
  }

  return {
    socketListeners: listeners,
    createdPeers: peers,
    MockPeerInstance: MockPeer,
  };
});

vi.mock('simple-peer', () => ({
  default: MockPeerInstance,
}));

vi.mock('../signaling', () => ({
  SERVER_URL: 'http://localhost:3001',
  sendSignal: vi.fn(),
  getSocket: () => ({
    on: (event: string, cb: SocketListener) => {
      if (event === 'signal') socketListeners.add(cb);
    },
    off: (event: string, cb: SocketListener) => {
      if (event === 'signal') socketListeners.delete(cb);
    },
  }),
}));

import {
  clearIceServersCache,
  createPeer,
  destroyPeer,
  isValidSignalData,
} from '../peer';

function emitSignal(signal: unknown) {
  for (const listener of socketListeners) {
    listener({ signal });
  }
}

describe('peer signal validation and delivery', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    destroyPeer();
    clearIceServersCache();
    createdPeers.length = 0;
    socketListeners.clear();
  });

  afterEach(() => {
    destroyPeer();
    globalThis.fetch = originalFetch;
  });

  it('validates typed candidate signals and rejects malformed candidate payloads', () => {
    expect(
      isValidSignalData({
        type: 'candidate',
        candidate: { candidate: 'candidate:1 1 udp 2122260223 127.0.0.1 12345 typ host', sdpMid: '0' },
      }),
    ).toBe(true);
    expect(isValidSignalData({ type: 'candidate' })).toBe(false);
    expect(isValidSignalData({ type: 'candidate', candidate: null })).toBe(false);
    expect(isValidSignalData({ type: 'candidate', candidate: 'not-an-object' })).toBe(false);
    expect(isValidSignalData({ type: 'candidate', candidate: [] })).toBe(false);
    expect(isValidSignalData({ type: 'offer', sdp: 'v=0...' })).toBe(true);
    expect(isValidSignalData({ candidate: { candidate: 'candidate:1' } })).toBe(true);
    expect(isValidSignalData({ type: 'unknown' })).toBe(false);
  });

  it('delivers typed candidate signals through both the pending-signal queue and live listener', async () => {
    let resolveFetch!: (res: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    const createPromise = createPeer(false, 'ABCD');

    const queuedCandidate = {
      type: 'candidate',
      candidate: { candidate: 'candidate:queued', sdpMid: '0', sdpMLineIndex: 0 },
    };
    const invalidCandidate = { type: 'candidate', candidate: null };

    // Arrives while /ice-servers fetch is still in flight (buffered in pendingSignals)
    emitSignal(queuedCandidate);
    emitSignal(invalidCandidate);
    expect(createdPeers).toHaveLength(0);

    resolveFetch(
      new Response(
        JSON.stringify({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await createPromise;

    expect(createdPeers).toHaveLength(1);
    expect(createdPeers[0].receivedSignals).toEqual([queuedCandidate]);

    // Arrives after peer construction (delivered via live listener)
    const liveCandidate = {
      type: 'candidate',
      candidate: { candidate: 'candidate:live', sdpMid: '0', sdpMLineIndex: 0 },
    };
    emitSignal(liveCandidate);
    emitSignal({ type: 'candidate', candidate: 'invalid' });

    expect(createdPeers[0].receivedSignals).toEqual([queuedCandidate, liveCandidate]);
  });
});

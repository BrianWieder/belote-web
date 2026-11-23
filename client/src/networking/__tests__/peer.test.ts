import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState } from '../../game/engine';

type SocketListener = (...args: unknown[]) => void;

const { mockSocket, sendSignalMock } = vi.hoisted(() => {
  const listeners = new Map<string, Set<SocketListener>>();
  return {
    sendSignalMock: vi.fn(),
    mockSocket: {
      listeners,
      on(event: string, fn: SocketListener) {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(fn);
      },
      off(event: string, fn?: SocketListener) {
        if (!fn) {
          listeners.delete(event);
        } else {
          listeners.get(event)?.delete(fn);
        }
      },
      trigger(event: string, payload: unknown) {
        for (const fn of [...(listeners.get(event) ?? [])]) {
          fn(payload);
        }
      },
      listenerCount(event: string) {
        return listeners.get(event)?.size ?? 0;
      },
      reset() {
        listeners.clear();
      },
    },
  };
});

vi.mock('../signaling', () => ({
  SERVER_URL: 'http://localhost:3001',
  getSocket: () => mockSocket,
  sendSignal: (...args: unknown[]) => sendSignalMock(...args),
}));

class MockRTCDataChannel {
  label: string;
  ordered: boolean;
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(label: string, init?: RTCDataChannelInit) {
    this.label = label;
    this.ordered = init?.ordered ?? true;
  }

  send = vi.fn((data: string) => {
    this.sent.push(data);
  });

  close = vi.fn(() => {
    this.closed = true;
    this.readyState = 'closed';
  });

  simulateOpen(): void {
    this.readyState = 'open';
    this.onopen?.({} as Event);
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  simulateClose(): void {
    this.readyState = 'closed';
    this.onclose?.({} as Event);
  }
}

const createdConnections: MockRTCPeerConnection[] = [];

class MockRTCPeerConnection {
  config: RTCConfiguration | undefined;
  signalingState: RTCSignalingState = 'stable';
  iceConnectionState: RTCIceConnectionState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  ondatachannel: ((ev: RTCDataChannelEvent) => void) | null = null;
  oniceconnectionstatechange: ((ev: Event) => void) | null = null;
  onconnectionstatechange: ((ev: Event) => void) | null = null;

  createdChannels: MockRTCDataChannel[] = [];
  addedCandidates: RTCIceCandidateInit[] = [];
  closed = false;
  offerCount = 0;

  constructor(config?: RTCConfiguration) {
    this.config = config;
    createdConnections.push(this);
  }

  createDataChannel = vi.fn((label: string, init?: RTCDataChannelInit) => {
    const ch = new MockRTCDataChannel(label, init);
    this.createdChannels.push(ch);
    return ch as unknown as RTCDataChannel;
  });

  createOffer = vi.fn(async (options?: RTCOfferOptions) => {
    this.offerCount += 1;
    const tag = options?.iceRestart ? 'ice-restart' : 'initial';
    return { type: 'offer' as const, sdp: `offer-sdp-${tag}-${this.offerCount}` };
  });

  createAnswer = vi.fn(async () => ({
    type: 'answer' as const,
    sdp: 'answer-sdp-1',
  }));

  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    if (desc.type === 'rollback') {
      this.localDescription = null;
      this.signalingState = 'stable';
      return;
    }
    this.localDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  });

  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      this.signalingState = 'stable';
    }
  });

  addIceCandidate = vi.fn(async (candidate: RTCIceCandidateInit) => {
    this.addedCandidates.push(candidate);
  });

  close = vi.fn(() => {
    this.closed = true;
    this.signalingState = 'closed';
    this.iceConnectionState = 'closed';
    this.connectionState = 'closed';
  });

  simulateIceCandidate(candidate: RTCIceCandidateInit | null): void {
    this.onicecandidate?.({
      candidate: candidate ? { ...candidate, toJSON: () => candidate } : null,
    } as unknown as RTCPeerConnectionIceEvent);
  }

  simulateDataChannel(channel: MockRTCDataChannel): void {
    this.ondatachannel?.({ channel } as unknown as RTCDataChannelEvent);
  }

  simulateIceState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.({} as Event);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

const TEST_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

import {
  clearIceServersCache,
  createPeer,
  DEFAULT_STUN_SERVERS,
  destroyPeer,
  getIceServers,
  hasTurnServer,
  isPeerConnected,
  isPeerMessage,
  sendPeerMessage,
  setMessageHandler,
  setStatusHandler,
  canRestartIce,
  restartIce,
  type PeerMessage,
  type PeerStatus,
} from '../peer';

describe('client ICE servers fetching and fallback', () => {
  beforeEach(() => {
    clearIceServersCache();
  });

  it('detects turn and turns URLs in string or array form', () => {
    expect(hasTurnServer([{ urls: 'stun:stun.l.google.com:19302' }])).toBe(false);
    expect(hasTurnServer([{ urls: 'turn:global.relay.metered.ca:80' }])).toBe(true);
    expect(
      hasTurnServer([{ urls: ['stun:a', 'turns:global.relay.metered.ca:443'] }]),
    ).toBe(true);
  });

  it('uses server-vended TURN servers, caches within TTL, and refreshes after expiry', async () => {
    let fetchCount = 0;
    let currentTime = 1_000;
    const mockFetch: typeof fetch = async (input) => {
      fetchCount++;
      expect(String(input)).toBe('https://signal.example.com/ice-servers');
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
              urls: 'turn:global.relay.metered.ca:443',
              username: `server-u-${fetchCount}`,
              credential: 'server-p',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const first = await getIceServers({
      serverUrl: 'https://signal.example.com/',
      fetchImpl: mockFetch,
      now: () => currentTime,
      cacheTtlMs: 60_000,
      legacyTurnUsername: 'legacy-u',
      legacyTurnCredential: 'legacy-p',
    });

    expect(fetchCount).toBe(1);
    expect(first).toHaveLength(2);
    expect(first[1].username).toBe('server-u-1');

    currentTime += 30_000;
    const second = await getIceServers({
      serverUrl: 'https://signal.example.com/',
      fetchImpl: mockFetch,
      now: () => currentTime,
      cacheTtlMs: 60_000,
    });
    expect(fetchCount).toBe(1);
    expect(second).toEqual(first);

    currentTime += 31_000;
    const third = await getIceServers({
      serverUrl: 'https://signal.example.com/',
      fetchImpl: mockFetch,
      now: () => currentTime,
      cacheTtlMs: 60_000,
    });
    expect(fetchCount).toBe(2);
    expect(third[1].username).toBe('server-u-2');
  });

  it('does not cache degraded STUN-only responses when no TURN servers are available', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          iceServers:
            calls === 1
              ? [{ urls: 'stun:stun.l.google.com:19302' }]
              : [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'turn:global.relay.metered.ca:443', username: 'u', credential: 'p' },
                ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const first = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(1);
    expect(hasTurnServer(first)).toBe(false);

    const second = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(2);
    expect(hasTurnServer(second)).toBe(true);
  });

  it('appends legacy client TURN credentials when server returns STUN-only', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const servers = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: 'legacy-u',
      legacyTurnCredential: 'legacy-p',
    });

    expect(servers).toHaveLength(5);
    expect(hasTurnServer(servers)).toBe(true);
    expect(servers[1].username).toBe('legacy-u');
    expect(servers[1].credential).toBe('legacy-p');
  });

  it('falls back to default STUN + legacy TURN when server request fails or times out', async () => {
    let calls = 0;
    const failingFetch: typeof fetch = async () => {
      calls++;
      throw new Error('Network unreachable');
    };

    const servers = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: failingFetch,
      legacyTurnUsername: 'legacy-u',
      legacyTurnCredential: 'legacy-p',
    });

    expect(calls).toBe(1);
    expect(servers).toHaveLength(DEFAULT_STUN_SERVERS.length + 4);
    expect(servers[DEFAULT_STUN_SERVERS.length].username).toBe('legacy-u');

    await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: failingFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(2);
  });

  it('falls back to default STUN-only when server fails and no legacy env vars exist', async () => {
    const slowFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const servers = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: slowFetch,
      timeoutMs: 20,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });

    expect(servers).toEqual([...DEFAULT_STUN_SERVERS]);
  });

  it('rejects entries containing malformed ICE URLs before TURN detection and caching', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: ['turn:relay.example:3478', 'not-an-ice-url'],
              username: 'u',
              credential: 'p',
            },
            { urls: 'turn:relay.example:notaport', username: 'u', credential: 'p' },
            { urls: 'turn:relay.example:99999', username: 'u', credential: 'p' },
            { urls: 'turn:relay.example:3478?transport=invalid', username: 'u', credential: 'p' },
            { urls: 'turn:relay.example:3478' },
            { urls: 'turn:relay.example:3478', username: 'u' },
            { urls: 'http://not-stun.example.com' },
            { urls: 'stun:stun.l.google.com:19302' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const first = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(1);
    expect(first).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(hasTurnServer(first)).toBe(false);

    await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(2);
  });

  it('keys ICE cache and in-flight requests by endpoint URL', async () => {
    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const isA = url.startsWith('https://a.example.com');
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
              urls: 'turn:global.relay.metered.ca:443',
              username: isA ? 'user-a' : 'user-b',
              credential: 'pass',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const [a, b] = await Promise.all([
      getIceServers({ serverUrl: 'https://a.example.com', fetchImpl: mockFetch }),
      getIceServers({ serverUrl: 'https://b.example.com', fetchImpl: mockFetch }),
    ]);

    expect(requestedUrls).toEqual([
      'https://a.example.com/ice-servers',
      'https://b.example.com/ice-servers',
    ]);
    expect(a[1].username).toBe('user-a');
    expect(b[1].username).toBe('user-b');
  });
});

describe('native WebRTC peer wrapper', () => {
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    clearIceServersCache();
    createdConnections.length = 0;
    mockSocket.reset();
    sendSignalMock.mockClear();
    globalThis.RTCPeerConnection = MockRTCPeerConnection as unknown as typeof RTCPeerConnection;
    setMessageHandler(null);
    setStatusHandler(null);
    destroyPeer();
  });

  afterEach(() => {
    destroyPeer();
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('host creates ordered belote data channel, sends offer, and handles answer + trickle ICE', async () => {
    const statuses: PeerStatus[] = [];
    setStatusHandler((s) => statuses.push(s));

    await createPeer(true, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    await flushMicrotasks();

    expect(createdConnections).toHaveLength(1);
    const pc = createdConnections[0];
    expect(pc.createDataChannel).toHaveBeenCalledWith('belote', { ordered: true });
    expect(sendSignalMock).toHaveBeenCalledWith('ROOM', {
      type: 'offer',
      sdp: 'offer-sdp-initial-1',
      offerId: expect.any(String),
    });
    const sentOffer = sendSignalMock.mock.calls[0][1] as { offerId: string };
    expect(statuses).toEqual(['connecting']);

    // Queue an ICE candidate before remote answer arrives
    const remoteCandidate = { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 };
    mockSocket.trigger('signal', { signal: { type: 'candidate', candidate: remoteCandidate } });
    await flushMicrotasks();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    // Stale answer for an old/mismatched offerId is discarded
    mockSocket.trigger('signal', {
      signal: { type: 'answer', sdp: 'stale-answer', offerId: 'stale-offer-id' },
    });
    await flushMicrotasks();
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();

    // Receive matching answer -> flushes queued ICE candidate
    mockSocket.trigger('signal', {
      signal: { type: 'answer', sdp: 'remote-answer', offerId: sentOffer.offerId },
    });
    await flushMicrotasks();
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'remote-answer' });
    expect(pc.addIceCandidate).toHaveBeenCalledWith(remoteCandidate);

    // Local trickle ICE candidate relays over signaling
    const localCandidate = { candidate: 'candidate:local', sdpMid: '0', sdpMLineIndex: 0 };
    pc.simulateIceCandidate(localCandidate);
    expect(sendSignalMock).toHaveBeenCalledWith('ROOM', {
      type: 'candidate',
      candidate: localCandidate,
    });

    // Channel opens -> connected
    pc.createdChannels[0].simulateOpen();
    expect(isPeerConnected()).toBe(true);
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('buffers offers and candidates arriving while /ice-servers fetch is in flight', async () => {
    let resolveFetch!: (res: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    const createPromise = createPeer(false, 'WAIT');

    const cand = { candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 };
    mockSocket.trigger('signal', { signal: { type: 'offer', sdp: 'early-offer' } });
    mockSocket.trigger('signal', { signal: { type: 'candidate', candidate: cand } });
    expect(createdConnections).toHaveLength(0);

    resolveFetch(
      new Response(
        JSON.stringify({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await createPromise;
    await flushMicrotasks();

    expect(createdConnections).toHaveLength(1);
    const pc = createdConnections[0];
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'early-offer' });
    expect(pc.addIceCandidate).toHaveBeenCalledWith(cand);
    expect(sendSignalMock).toHaveBeenCalledWith('WAIT', { type: 'answer', sdp: 'answer-sdp-1' });
  });

  it('guest answers incoming offer, flushes queued candidates, and attaches remote data channel', async () => {
    const received: PeerMessage[] = [];
    setMessageHandler((m) => received.push(m));

    await createPeer(false, 'ABCD', { iceServers: TEST_ICE_SERVERS });
    const pc = createdConnections[0];
    expect(pc.createDataChannel).not.toHaveBeenCalled();

    const cand = { candidate: 'candidate:host', sdpMid: '0', sdpMLineIndex: 0 };
    mockSocket.trigger('signal', { signal: { type: 'candidate', candidate: cand } });
    await flushMicrotasks();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    mockSocket.trigger('signal', { signal: { type: 'offer', sdp: 'host-offer' } });
    await flushMicrotasks();

    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'host-offer' });
    expect(pc.addIceCandidate).toHaveBeenCalledWith(cand);
    expect(sendSignalMock).toHaveBeenCalledWith('ABCD', { type: 'answer', sdp: 'answer-sdp-1' });

    const remoteChannel = new MockRTCDataChannel('belote', { ordered: true });
    pc.simulateDataChannel(remoteChannel);
    remoteChannel.simulateOpen();
    expect(isPeerConnected()).toBe(true);

    // Unexpected or duplicate remote data channels are closed and cannot clobber the active channel
    const rogueChannel = new MockRTCDataChannel('other', { ordered: true });
    pc.simulateDataChannel(rogueChannel);
    expect(rogueChannel.close).toHaveBeenCalled();
    const duplicateChannel = new MockRTCDataChannel('belote', { ordered: true });
    pc.simulateDataChannel(duplicateChannel);
    expect(duplicateChannel.close).toHaveBeenCalled();
    duplicateChannel.simulateClose();
    expect(isPeerConnected()).toBe(true);

    expect(sendPeerMessage({ type: 'new-round' })).toBe(true);
    expect(remoteChannel.sent).toEqual([JSON.stringify({ type: 'new-round' })]);

    remoteChannel.simulateMessage(JSON.stringify({ type: 'resync-request' }));
    expect(received).toEqual([{ type: 'resync-request' }]);
  });

  it('validates every PeerMessage variant and rejects malformed or partial payloads', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const received: PeerMessage[] = [];
    setMessageHandler((m) => received.push(m));

    await createPeer(true, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    const ch = createdConnections[0].createdChannels[0];
    ch.simulateOpen();

    // Malformed JSON and invalid variant payloads
    expect(() => ch.simulateMessage('{not valid json')).not.toThrow();
    expect(() => ch.simulateMessage('123')).not.toThrow();
    expect(() => ch.simulateMessage(JSON.stringify({ nope: true }))).not.toThrow();
    // Partial game-state missing roundScores and other required fields must be rejected
    expect(() =>
      ch.simulateMessage(
        JSON.stringify({
          type: 'game-state',
          state: { seed: 'abc', sequenceNumber: 99 },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      ch.simulateMessage(JSON.stringify({ type: 'sync-seed', seed: '', dealer: 0 })),
    ).not.toThrow();
    expect(() =>
      ch.simulateMessage(
        JSON.stringify({ type: 'game-action', action: { type: 'bid-choose', suit: 'invalid' }, seq: 1 }),
      ),
    ).not.toThrow();
    expect(() =>
      ch.simulateMessage(
        JSON.stringify({ type: 'game-action', action: { type: 'play-card', card: 'invalid' }, seq: 1 }),
      ),
    ).not.toThrow();
    expect(() =>
      ch.simulateMessage(JSON.stringify({ type: 'new-round', seq: -1 })),
    ).not.toThrow();
    expect(received).toEqual([]);

    // Valid complete messages pass validation and reach messageHandler
    const validState = createInitialState('peer-msg-test', 0);
    expect(isPeerMessage({ type: 'game-state', state: validState })).toBe(true);
    expect(isPeerMessage({ type: 'round-ready', round: 1 })).toBe(true);
    expect(isPeerMessage({ type: 'round-ready', round: 0 })).toBe(false);
    expect(isPeerMessage({ type: 'round-ready', round: '1' })).toBe(false);
    expect(isPeerMessage({ type: 'rematch-ready' })).toBe(true);
    expect(isPeerMessage({ type: 'rematch-start', seed: 'abc', dealer: 1 })).toBe(true);
    expect(
      isPeerMessage({
        type: 'rematch-start',
        seed: 'abc',
        dealer: 1,
        options: { targetScore: 1500, capotEnabled: true },
      }),
    ).toBe(true);
    expect(
      isPeerMessage({
        type: 'rematch-start',
        seed: 'abc',
        dealer: 1,
        options: { targetScore: 999, capotEnabled: true },
      }),
    ).toBe(false);
    expect(
      isPeerMessage({
        type: 'sync-seed',
        seed: 'abc',
        dealer: 0,
        options: { targetScore: 500, capotEnabled: false },
      }),
    ).toBe(true);
    expect(
      isPeerMessage({
        type: 'sync-seed',
        seed: 'abc',
        dealer: 0,
        options: { targetScore: 750, capotEnabled: false },
      }),
    ).toBe(false);
    expect(isPeerMessage({ type: 'player-info', name: 'Camille' })).toBe(true);
    expect(isPeerMessage({ type: 'player-info', name: 123 })).toBe(false);
    expect(isPeerMessage({ type: 'reaction', id: 'bien-joue' })).toBe(true);
    expect(isPeerMessage({ type: 'reaction', id: 'invalid' })).toBe(false);
    expect(isPeerMessage({ type: 'rematch-start', seed: '', dealer: 0 })).toBe(false);
    expect(isPeerMessage({ type: 'rematch-start', seed: 'abc', dealer: 2 })).toBe(false);
    ch.simulateMessage(JSON.stringify({ type: 'game-state', state: validState }));
    ch.simulateMessage(JSON.stringify({ type: 'new-round', seq: 2 }));
    ch.simulateMessage(
      JSON.stringify({ type: 'game-action', action: { type: 'bid-take' }, seq: 1 }),
    );
    ch.simulateMessage(
      JSON.stringify({ type: 'game-action', action: { type: 'bid-choose', suit: 'hearts' }, seq: 2 }),
    );
    ch.simulateMessage(
      JSON.stringify({ type: 'game-action', action: { type: 'play-card', card: 'A_spades' }, seq: 3 }),
    );
    expect(received).toHaveLength(5);
    expect(received[0]).toEqual({ type: 'game-state', state: validState });
    expect(received[1]).toEqual({ type: 'new-round', seq: 2 });
    expect(received[2]).toEqual({
      type: 'game-action',
      action: { type: 'bid-take' },
      seq: 1,
    });
    expect(received[3]).toEqual({
      type: 'game-action',
      action: { type: 'bid-choose', suit: 'hearts' },
      seq: 2,
    });
    expect(received[4]).toEqual({
      type: 'game-action',
      action: { type: 'play-card', card: 'A_spades' },
      seq: 3,
    });
    warnSpy.mockRestore();
  });

  it('cleans up previous connection and guards against stale callbacks via generation ID', async () => {
    const statuses: PeerStatus[] = [];
    const received: PeerMessage[] = [];
    setStatusHandler((s) => statuses.push(s));
    setMessageHandler((m) => received.push(m));

    await createPeer(true, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    const firstPc = createdConnections[0];
    const firstChannel = firstPc.createdChannels[0];
    expect(mockSocket.listenerCount('signal')).toBe(1);

    // Replace with a second peer
    await createPeer(true, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    const secondPc = createdConnections[1];
    const secondChannel = secondPc.createdChannels[0];

    expect(firstPc.close).toHaveBeenCalled();
    expect(firstChannel.close).toHaveBeenCalled();
    expect(mockSocket.listenerCount('signal')).toBe(1);

    // Open second channel
    secondChannel.simulateOpen();
    expect(isPeerConnected()).toBe(true);

    // Stale events on first connection must NOT clobber the second connection
    firstChannel.simulateClose();
    firstChannel.simulateMessage(JSON.stringify({ type: 'new-round' }));
    firstPc.simulateIceState('failed');

    expect(isPeerConnected()).toBe(true);
    expect(received).toEqual([]);
    expect(statuses[statuses.length - 1]).toBe('connected');

    destroyPeer();
    expect(mockSocket.listenerCount('signal')).toBe(0);
    expect(secondPc.close).toHaveBeenCalled();
    expect(isPeerConnected()).toBe(false);
    expect(sendPeerMessage({ type: 'new-round' })).toBe(false);
  });

  it('times out stuck ICE setup and emits disconnected', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const statuses: PeerStatus[] = [];
    setStatusHandler((s) => statuses.push(s));

    await createPeer(true, 'ROOM', {
      setupTimeoutMs: 5_000,
      iceServers: TEST_ICE_SERVERS,
    });
    const pc = createdConnections[0];

    vi.advanceTimersByTime(4_999);
    expect(statuses).toEqual(['connecting']);
    expect(pc.closed).toBe(false);

    vi.advanceTimersByTime(1);
    expect(statuses).toEqual(['connecting', 'disconnected']);
    expect(pc.closed).toBe(true);
    expect(mockSocket.listenerCount('signal')).toBe(0);
    warnSpy.mockRestore();
  });

  it('supports ICE restart and restores connected status when ICE recovers', async () => {
    const statuses: PeerStatus[] = [];
    setStatusHandler((s) => statuses.push(s));

    await createPeer(true, 'ROOM', {
      iceDisconnectGraceMs: 1_000,
      iceServers: TEST_ICE_SERVERS,
    });
    await flushMicrotasks();
    const pc = createdConnections[0];
    const ch = pc.createdChannels[0];
    ch.simulateOpen();
    sendSignalMock.mockClear();

    // Transient ICE disconnect exceeds grace window -> disconnected
    pc.simulateIceState('disconnected');
    vi.advanceTimersByTime(1_000);
    expect(isPeerConnected()).toBe(false);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);

    // A data-channel message arriving while ICE is still disconnected must NOT mark connected
    ch.simulateMessage(JSON.stringify({ type: 'resync-request' }));
    expect(isPeerConnected()).toBe(false);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);

    // Channel is still open -> ICE restart is possible
    expect(canRestartIce()).toBe(true);
    const restarted = await restartIce();
    expect(restarted).toBe(true);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(sendSignalMock).toHaveBeenCalledWith('ROOM', {
      type: 'offer',
      sdp: 'offer-sdp-ice-restart-2',
      offerId: expect.any(String),
    });

    // ICE recovers -> connected again
    pc.simulateIceState('connected');
    expect(isPeerConnected()).toBe(true);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected', 'connected']);
  });

  it('impolite host ignores colliding offers while polite guest accepts', async () => {
    await createPeer(true, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    await flushMicrotasks();
    const hostPc = createdConnections[0];
    expect(hostPc.signalingState).toBe('have-local-offer');

    mockSocket.trigger('signal', { signal: { type: 'offer', sdp: 'colliding-offer' } });
    await flushMicrotasks();
    expect(hostPc.setRemoteDescription).not.toHaveBeenCalled();

    await createPeer(false, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    const guestPc = createdConnections[1];
    guestPc.signalingState = 'have-local-offer';
    mockSocket.trigger('signal', { signal: { type: 'offer', sdp: 'host-offer' } });
    await flushMicrotasks();

    expect(guestPc.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
    expect(guestPc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'host-offer' });
  });

  it('converts wss:// and ws:// signaling URLs to https:// and http:// when fetching /ice-servers', async () => {
    const requestedUrls: string[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: 'turn:relay.example.com:443',
              username: 'u',
              credential: 'p',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    clearIceServersCache();
    await getIceServers({
      serverUrl: 'wss://signal.example.com/belote?v=1',
      fetchImpl: mockFetch,
    });
    await getIceServers({
      serverUrl: 'ws://localhost:3001',
      fetchImpl: mockFetch,
    });

    expect(requestedUrls).toEqual([
      'https://signal.example.com/belote/ice-servers',
      'http://localhost:3001/ice-servers',
    ]);
  });

  it('ignores stale offers from older negotiations and serializes concurrent offers', async () => {
    await createPeer(false, 'ROOM', {
      iceServers: TEST_ICE_SERVERS,
      negotiationId: 2,
    });
    await flushMicrotasks();
    const guestPc = createdConnections[0];

    // Stale offer from negotiation #1 must be ignored completely
    mockSocket.trigger('signal', {
      signal: { type: 'offer', sdp: 'stale-offer-neg-1', offerId: '1-1', negotiationId: 1 },
    });
    await flushMicrotasks();
    expect(guestPc.setRemoteDescription).not.toHaveBeenCalled();
    expect(sendSignalMock).not.toHaveBeenCalled();

    // Fresh offer from negotiation #2 is accepted and answered with matching negotiationId & offerId
    mockSocket.trigger('signal', {
      signal: { type: 'offer', sdp: 'fresh-offer-neg-2', offerId: '2-1', negotiationId: 2 },
    });
    await flushMicrotasks();
    expect(guestPc.setRemoteDescription).toHaveBeenCalledWith({
      type: 'offer',
      sdp: 'fresh-offer-neg-2',
    });
    expect(sendSignalMock).toHaveBeenCalledWith('ROOM', {
      type: 'answer',
      sdp: 'answer-sdp-1',
      offerId: '2-1',
      negotiationId: 2,
    });
  });

  it('tears down failed initial ICE setup and keeps pendingOfferId when an answer is rejected', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: PeerStatus[] = [];
    setStatusHandler((s) => statuses.push(s));

    await createPeer(true, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    await flushMicrotasks();
    const pc = createdConnections[0];
    const sentOffer = sendSignalMock.mock.calls[0][1] as { offerId: string };

    // Reject the first matching answer -> connection stays in have-local-offer and pendingOfferId remains armed
    pc.setRemoteDescription.mockRejectedValueOnce(new Error('transient SDP error'));
    mockSocket.trigger('signal', {
      signal: { type: 'answer', sdp: 'bad-answer', offerId: sentOffer.offerId },
    });
    await flushMicrotasks();

    // A stale answer for a different offerId must still be rejected
    mockSocket.trigger('signal', {
      signal: { type: 'answer', sdp: 'stale-answer', offerId: 'wrong-offer' },
    });
    await flushMicrotasks();
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);

    // A subsequent valid answer for the same offerId is accepted
    mockSocket.trigger('signal', {
      signal: { type: 'answer', sdp: 'good-answer', offerId: sentOffer.offerId },
    });
    await flushMicrotasks();
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(2);
    expect(pc.setRemoteDescription).toHaveBeenLastCalledWith({
      type: 'answer',
      sdp: 'good-answer',
    });

    // Terminal ICE failure before first channel open tears down peer and signal listener
    pc.simulateIceState('failed');
    expect(pc.closed).toBe(true);
    expect(mockSocket.listenerCount('signal')).toBe(0);
    expect(statuses).toEqual(['connecting', 'disconnected']);
    errorSpy.mockRestore();
  });

  it('tears down when data channel closes during initial setup and preserves setup timer across re-entrant createPeer', async () => {
    const statuses: PeerStatus[] = [];
    setStatusHandler((s) => statuses.push(s));

    await createPeer(true, 'ROOM', {
      setupTimeoutMs: 5_000,
      iceServers: TEST_ICE_SERVERS,
    });
    await flushMicrotasks();
    const pc1 = createdConnections[0];
    const ch1 = pc1.createdChannels[0];

    // Data channel closes before ever opening -> full teardown
    ch1.simulateClose();
    expect(pc1.closed).toBe(true);
    expect(mockSocket.listenerCount('signal')).toBe(0);
    expect(statuses).toEqual(['connecting', 'disconnected']);

    // Re-entrant createPeer inside 'connecting' handler keeps newer peer's setup timer intact
    let triggeredReentrant = false;
    const reentrantStatuses: PeerStatus[] = [];
    setStatusHandler((s) => {
      reentrantStatuses.push(s);
      if (s === 'connecting' && !triggeredReentrant) {
        triggeredReentrant = true;
        void createPeer(true, 'ROOM', {
          setupTimeoutMs: 5_000,
          iceServers: TEST_ICE_SERVERS,
        });
      }
    });

    await createPeer(true, 'ROOM', {
      setupTimeoutMs: 1_000,
      iceServers: TEST_ICE_SERVERS,
    });
    await flushMicrotasks();

    // First peer's 1_000ms timer must NOT fire or clobber the second peer's 5_000ms timer
    vi.advanceTimersByTime(1_000);
    const pcLatest = createdConnections[createdConnections.length - 1];
    expect(pcLatest.closed).toBe(false);

    vi.advanceTimersByTime(4_000);
    expect(pcLatest.closed).toBe(true);
  });

  it('queues ICE candidates belonging to a future ICE restart ufrag until the restart SDP is applied', async () => {
    await createPeer(false, 'ROOM', { iceServers: TEST_ICE_SERVERS });
    await flushMicrotasks();
    const guestPc = createdConnections[0];

    // Initial offer with ufrag "gen1"
    mockSocket.trigger('signal', {
      signal: { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:gen1\r\n', offerId: 'o1' },
    });
    await flushMicrotasks();

    // Candidate for next ICE restart generation ("gen2") arrives BEFORE restart offer
    const gen2Candidate = {
      candidate: 'candidate:2',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'gen2',
    };
    mockSocket.trigger('signal', {
      signal: { type: 'candidate', candidate: gen2Candidate },
    });
    await flushMicrotasks();
    expect(guestPc.addIceCandidate).not.toHaveBeenCalled();

    // Restart offer with ufrag "gen2" arrives -> applies SDP and flushes the queued gen2 candidate
    mockSocket.trigger('signal', {
      signal: { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:gen2\r\n', offerId: 'o2' },
    });
    await flushMicrotasks();
    expect(guestPc.addIceCandidate).toHaveBeenCalledTimes(1);
    expect(guestPc.addIceCandidate).toHaveBeenCalledWith(gen2Candidate);

    // Late candidate for retired ufrag "gen1" is discarded, and oversized/flooded future candidates are bounded
    guestPc.addIceCandidate.mockClear();
    mockSocket.trigger('signal', {
      signal: {
        type: 'candidate',
        candidate: { candidate: 'candidate:old', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'gen1' },
      },
    });
    mockSocket.trigger('signal', {
      signal: {
        type: 'candidate',
        candidate: {
          candidate: 'x'.repeat(40_000),
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'gen3',
        },
      },
    });
    const validGen3Candidate = {
      candidate: 'candidate:3',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'gen3',
    };
    mockSocket.trigger('signal', {
      signal: { type: 'candidate', candidate: validGen3Candidate },
    });
    await flushMicrotasks();

    // Moving to gen3 flushes only the valid bounded gen3 candidate (not oversized gen3 or retired gen1)
    mockSocket.trigger('signal', {
      signal: { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:gen3\r\n', offerId: 'o3' },
    });
    await flushMicrotasks();
    expect(guestPc.addIceCandidate).toHaveBeenCalledTimes(1);
    expect(guestPc.addIceCandidate).toHaveBeenCalledWith(validGen3Candidate);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PeerMessage, PeerStatus } from '../../networking/peer';

type SocketListener = (...args: unknown[]) => void;

const cleanups: Array<() => void> = [];

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') {
      cleanups.push(cleanup);
    }
  },
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useRef: <T,>(initial: T) => ({ current: initial }),
}));

vi.mock('../../store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/gameStore')>();
  const mockUseGameStore = Object.assign(
    <T,>(selector?: (state: ReturnType<typeof actual.useGameStore.getState>) => T) => {
      const state = actual.useGameStore.getState();
      return selector ? selector(state) : state;
    },
    actual.useGameStore,
  );
  return { ...actual, useGameStore: mockUseGameStore };
});

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<SocketListener>>();
  let messageCb: ((msg: PeerMessage) => void) | null = null;
  let statusCb: ((status: PeerStatus) => void) | null = null;
  let signalingConnected = true;
  let peerConnected = false;

  return {
    get signalingConnected() {
      return signalingConnected;
    },
    set signalingConnected(v: boolean) {
      signalingConnected = v;
    },
    get peerConnected() {
      return peerConnected;
    },
    set peerConnected(v: boolean) {
      peerConnected = v;
    },
    emitMessage(msg: PeerMessage) {
      messageCb?.(msg);
    },
    emitStatus(status: PeerStatus) {
      statusCb?.(status);
    },
    setMessageHandler: vi.fn((cb: ((msg: PeerMessage) => void) | null) => {
      messageCb = cb;
    }),
    setStatusHandler: vi.fn((cb: ((status: PeerStatus) => void) | null) => {
      statusCb = cb;
    }),
    createPeer: vi.fn(async () => {}),
    destroyPeer: vi.fn(() => {
      peerConnected = false;
    }),
    sendPeerMessage: vi.fn(() => true),
    getIceServers: vi.fn(async () => []),
    canRestartIce: vi.fn(() => false),
    restartIce: vi.fn(async () => false),
    connectSignaling: vi.fn(async () => {
      signalingConnected = true;
    }),
    createRoom: vi.fn(async () => ({ code: 'ABCD', reconnectToken: 'tok-host' })),
    joinRoom: vi.fn<
      (
        code: string,
        timeoutMs?: number,
        isCurrent?: () => boolean,
      ) => Promise<{ success: boolean; error?: string; reconnectToken?: string }>
    >(async () => ({ success: true, reconnectToken: 'tok-guest' })),
    rejoinRoom: vi.fn<() => Promise<{
      success: boolean;
      error?: string;
      role?: 'host' | 'guest';
      peerPresent?: boolean;
      alreadyNegotiating?: boolean;
      negotiationId?: number;
    }>>(async () => ({ success: true })),
    confirmPeerConnected: vi.fn<() => Promise<'confirmed' | 'rejected' | 'ambiguous'>>(
      async () => (signalingConnected ? 'confirmed' : 'ambiguous'),
    ),
    notifyPeerConnected: vi.fn(),
    leaveRoom: vi.fn(),
    disconnectSignaling: vi.fn(() => {
      signalingConnected = false;
    }),
    mockSocket: {
      on(event: string, fn: SocketListener) {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(fn);
      },
      off(event: string, fn?: SocketListener) {
        if (!fn) listeners.delete(event);
        else listeners.get(event)?.delete(fn);
      },
      trigger(event: string, ...args: unknown[]) {
        for (const fn of [...(listeners.get(event) ?? [])]) {
          fn(...args);
        }
      },
      reset() {
        listeners.clear();
      },
    },
  };
});

vi.mock('../../networking/peer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../networking/peer')>();
  return {
    createPeer: mocks.createPeer,
    getIceServers: mocks.getIceServers,
    isSignalPayload: actual.isSignalPayload,
    setMessageHandler: mocks.setMessageHandler,
    setStatusHandler: mocks.setStatusHandler,
    sendPeerMessage: mocks.sendPeerMessage,
    destroyPeer: mocks.destroyPeer,
    isPeerConnected: () => mocks.peerConnected,
    canRestartIce: mocks.canRestartIce,
    restartIce: mocks.restartIce,
  };
});

vi.mock('../../networking/signaling', () => ({
  connectSignaling: mocks.connectSignaling,
  createRoom: mocks.createRoom,
  joinRoom: mocks.joinRoom,
  rejoinRoom: mocks.rejoinRoom,
  confirmPeerConnected: mocks.confirmPeerConnected,
  notifyPeerConnected: mocks.notifyPeerConnected,
  leaveRoom: mocks.leaveRoom,
  isSignalingConnected: () => mocks.signalingConnected,
  disconnectSignaling: mocks.disconnectSignaling,
  getSocket: () => mocks.mockSocket,
}));

import { usePeer } from '../usePeer';
import { useGameStore } from '../../store/gameStore';

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe('usePeer guest initial setup confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSocket.reset();
    mocks.signalingConnected = true;
    mocks.peerConnected = false;
    useGameStore.getState().resetConnection();
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    useGameStore.getState().resetConnection();
  });

  it('aborts guest match start if signaling drops before server commits and reconcile rejects', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');
      expect(useGameStore.getState().connectionStatus).toBe('connecting');

      // Data channel opens, guest stays on connecting screen awaiting sync-seed
      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      expect(useGameStore.getState().connectionStatus).toBe('connecting');
      expect(useGameStore.getState().gameState).toBeNull();

      // Signaling drops before sync-seed arrives -> ambiguous confirm, server reports unstarted
      mocks.destroyPeer.mockClear();
      mocks.signalingConnected = false;
      mocks.rejoinRoom.mockResolvedValueOnce({ success: false, error: 'Game has not started' });
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-1', dealer: 0 });
      await flushMicrotasks();

      expect(mocks.confirmPeerConnected).toHaveBeenCalledWith('ABCD', 0);
      expect(mocks.rejoinRoom).toHaveBeenCalledWith('ABCD', 'guest', 'tok-guest', 4_000, {
        passive: true,
      });
      expect(mocks.destroyPeer).toHaveBeenCalledTimes(1);
      expect(useGameStore.getState().gameState).toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('connecting');
      expect(useGameStore.getState().connectionError).toMatch(/rejoin/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers guest match when server committed before signaling ACK was lost', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.signalingConnected = false;
    mocks.rejoinRoom.mockResolvedValueOnce({
      success: true,
      role: 'guest',
      peerPresent: true,
      alreadyNegotiating: true,
    });

    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-committed', dealer: 0 });
    await flushMicrotasks();

    expect(useGameStore.getState().gameState).not.toBeNull();
    expect(useGameStore.getState().connectionStatus).toBe('connected');
  });

  it('buffers gameplay messages arriving during guest confirmation and does not publish connected if peer closed', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    let resolveConfirm!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
    mocks.confirmPeerConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    // Dealer is 1 so player 0 (host) acts first in bidding-round1
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-buf', dealer: 1 });
    // Host bids immediately while guest confirmation ACK is still in flight
    mocks.emitMessage({ type: 'game-action', action: { type: 'bid-pass' }, seq: 1 });
    // Peer channel closes before the confirmation ACK resolves
    mocks.peerConnected = false;
    mocks.emitStatus('disconnected');

    resolveConfirm('confirmed');
    await flushMicrotasks();

    const state = useGameStore.getState();
    expect(state.gameState).not.toBeNull();
    // Buffered host bid-pass was replayed in order on top of the opening state
    expect(state.gameState?.sequenceNumber).toBe(1);
    // Must enter reconnecting (not publish 'connected' on a closed peer channel)
    expect(state.connectionStatus).toBe('reconnecting');
  });

  it('starts guest match once server confirms peer-connected after sync-seed', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    let resolveConfirm!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
    mocks.confirmPeerConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-ok', dealer: 0 });
    expect(useGameStore.getState().gameState).toBeNull();

    resolveConfirm('confirmed');
    await flushMicrotasks();

    expect(mocks.confirmPeerConnected).toHaveBeenCalledWith('ABCD', 0);
    expect(useGameStore.getState().gameState).not.toBeNull();
    expect(useGameStore.getState().connectionStatus).toBe('connected');
  });

  it('retains peer-reconnected notifications arriving during confirmation and ignores stale session confirmations', async () => {
    const api = usePeer();
    await api.joinGame('ROOMA');

    let resolveRoomA!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
    mocks.confirmPeerConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRoomA = resolve;
        }),
    );

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-a', dealer: 1 });

    // User cancels ROOM A and joins ROOM B while ROOM A's confirmation is still pending
    api.cancelConnection();
    await api.joinGame('ROOMB');

    let resolveRoomB!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
    mocks.confirmPeerConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRoomB = resolve;
        }),
    );

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-b', dealer: 1 });
    mocks.emitMessage({ type: 'game-action', action: { type: 'bid-pass' }, seq: 1 });
    // Host renegotiates while ROOM B's guest confirmation is still pending and sends its offer early
    mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 3 });
    const earlyOffer = {
      type: 'offer' as const,
      sdp: 'offer-sdp-neg-3',
      offerId: '3-1',
      negotiationId: 3,
    };
    mocks.mockSocket.trigger('signal', { signal: earlyOffer });

    // Stale ROOM A confirmation settles -> must NOT wipe ROOM B's queued action or pending state
    resolveRoomA('rejected');
    await flushMicrotasks();

    mocks.createPeer.mockClear();
    resolveRoomB('confirmed');
    await flushMicrotasks();

    const state = useGameStore.getState();
    expect(state.gameState?.sequenceNumber).toBe(1);
    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ROOMB', {
      negotiationId: 3,
      initialSignals: [earlyOffer],
    });
  });

  it('keeps guest confirmation retry alive across WebRTC recovery and invalidates confirmation on explicit room closure', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;
      mocks.rejoinRoom
        .mockRejectedValueOnce(new Error('Rejoining room timed out'))
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: true,
        });

      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-retry', dealer: 0 });
      await flushMicrotasks();

      // WebRTC recovers mid-backoff -> must NOT cancel guest confirmation retry timer
      mocks.emitStatus('connected');
      expect(useGameStore.getState().gameState).toBeNull();

      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(2);
      expect(useGameStore.getState().gameState).not.toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('connected');

      // Explicit host closure (preserved: false) invalidates an in-flight guest confirmation
      api.cancelConnection();
      await api.joinGame('CLOS');
      let resolveClosed!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
      mocks.confirmPeerConnected.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClosed = resolve;
          }),
      );
      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-closed', dealer: 0 });

      mocks.mockSocket.trigger('peer-disconnected', { preserved: false });
      expect(useGameStore.getState().connectionStatus).toBe('disconnected');

      resolveClosed('rejected');
      await flushMicrotasks();
      expect(useGameStore.getState().connectionStatus).toBe('disconnected');
      expect(useGameStore.getState().gameState).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts replacement peer with buffered early offer for same-negotiation confirmation retry and active-game rejoin', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    // Case 1: Guest confirmation retry receives alreadyNegotiating: true with negotiationId: 1
    // while peer is disconnected and host's offer for negotiation 1 already arrived early
    mocks.peerConnected = false;
    mocks.signalingConnected = false;
    const earlyOfferNeg1 = {
      type: 'offer' as const,
      sdp: 'offer-sdp-neg-1',
      offerId: '1-1',
      negotiationId: 1,
    };
    mocks.rejoinRoom.mockImplementationOnce(async () => {
      mocks.mockSocket.trigger('signal', { signal: earlyOfferNeg1 });
      return {
        success: true,
        role: 'guest',
        peerPresent: true,
        alreadyNegotiating: true,
        negotiationId: 1,
      };
    });

    mocks.createPeer.mockClear();
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-rejoin-neg1', dealer: 0 });
    await flushMicrotasks();

    expect(useGameStore.getState().gameState).not.toBeNull();
    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
      negotiationId: 1,
      initialSignals: [earlyOfferNeg1],
    });

    // Mark negotiation 1 connected, then drop mid-game and verify active-game rejoin buffers early offer for negotiation 2
    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.createPeer.mockClear();

    const earlyOfferNeg2 = {
      type: 'offer' as const,
      sdp: 'offer-sdp-neg-2',
      offerId: '2-1',
      negotiationId: 2,
    };
    mocks.rejoinRoom.mockImplementationOnce(async () => {
      mocks.mockSocket.trigger('signal', { signal: earlyOfferNeg2 });
      return {
        success: true,
        role: 'guest',
        peerPresent: true,
        alreadyNegotiating: false,
        negotiationId: 2,
      };
    });

    mocks.peerConnected = false;
    mocks.emitStatus('disconnected');
    await flushMicrotasks();

    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
      negotiationId: 2,
      initialSignals: [earlyOfferNeg2],
    });
  });

  it('requests a fresh negotiation when an active rejoin returns the completed negotiation ID after channel close', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-dedupe', dealer: 0 });
      await flushMicrotasks();
      expect(useGameStore.getState().connectionStatus).toBe('connected');

      // Channel drops inside server dedupe window -> first rejoin returns completed negotiationId 0,
      // hook schedules a retry with failedNegotiationId: 0 which mints negotiation 1
      mocks.rejoinRoom
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: true,
          negotiationId: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 1,
        });

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();

      expect(mocks.createPeer).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenLastCalledWith(
        'ABCD',
        'guest',
        'tok-guest',
        expect.any(Number),
        { retry: true, failedNegotiationId: 0 },
      );
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a waiting active rejoin when signaling reconnects after peerPresent: false', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-wait', dealer: 0 });
    await flushMicrotasks();

    // First active rejoin gets peerPresent: false -> client waits for peer-reconnected
    mocks.rejoinRoom
      .mockResolvedValueOnce({
        success: true,
        role: 'guest',
        peerPresent: false,
        alreadyNegotiating: false,
      })
      .mockResolvedValueOnce({
        success: true,
        role: 'guest',
        peerPresent: true,
        alreadyNegotiating: false,
        negotiationId: 1,
      });

    mocks.createPeer.mockClear();
    mocks.peerConnected = false;
    mocks.emitStatus('disconnected');
    await flushMicrotasks();

    expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);
    expect(mocks.createPeer).not.toHaveBeenCalled();

    // Signaling drops and reconnects while waiting -> resumes active rejoin on the new socket
    mocks.mockSocket.trigger('connect');
    await flushMicrotasks();

    expect(mocks.rejoinRoom).toHaveBeenCalledTimes(2);
    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 1 });
  });

  it('caps the guest confirmation queue and triggers a full-state resync on overflow', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    let resolveConfirm!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
    mocks.confirmPeerConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-cap', dealer: 1 });

    // Exceed the 64-message confirmation queue cap
    for (let i = 1; i <= 70; i++) {
      mocks.emitMessage({ type: 'game-action', action: { type: 'bid-pass' }, seq: i });
    }

    mocks.sendPeerMessage.mockClear();
    resolveConfirm('confirmed');
    await flushMicrotasks();

    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);
    expect(useGameStore.getState().connectionStatus).toBe('connected');
    expect(mocks.sendPeerMessage).toHaveBeenCalledWith({ type: 'resync-request' });
  });

  it('ignores late rejoin rejections once a newer peer-reconnected negotiation has started', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-supersede', dealer: 0 });
      await flushMicrotasks();

      let rejectOldRejoin!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOldRejoin = reject;
          }),
      );

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();
      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);

      // A newer negotiation (#2) starts via peer-reconnected while the old rejoin is still pending
      mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 2 });
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 2 });

      // Old rejoin later rejects -> must NOT schedule a retry that replaces negotiation #2
      rejectOldRejoin(new Error('Rejoining room timed out'));
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(2_000);
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps provisional host recovery retrying when rejoin returns Game has not started before guest confirms', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { search: '' } });
    try {
      const api = usePeer();
      await api.hostGame();

      // Host opens data channel and deals opening state (hasStarted pending guest confirmation)
      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      expect(useGameStore.getState().gameState).not.toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('connected');

      // Channel drops right after opening deal: first host rejoin beats guest confirmation
      mocks.rejoinRoom
        .mockResolvedValueOnce({ success: false, error: 'Game has not started' })
        .mockResolvedValueOnce({
          success: true,
          role: 'host',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 1,
        });

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();

      // Must stay reconnecting (not terminal 'disconnected') and retry within the deadline
      expect(useGameStore.getState().connectionStatus).toBe('reconnecting');
      expect(mocks.createPeer).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(2);
      expect(mocks.createPeer).toHaveBeenCalledWith(true, 'ABCD', { negotiationId: 1 });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('keeps buffering replacement offers if old channel recovers before an outstanding rejoin ACK arrives', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-buffer-after-recover', dealer: 0 });
    await flushMicrotasks();

    let resolveRejoin!: (res: {
      success: boolean;
      role: 'guest';
      peerPresent: boolean;
      alreadyNegotiating: boolean;
      negotiationId: number;
    }) => void;
    mocks.rejoinRoom.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRejoin = resolve;
        }),
    );

    // Channel drops -> active rejoin starts and awaits ACK
    mocks.peerConnected = false;
    mocks.emitStatus('disconnected');
    await flushMicrotasks();
    expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);

    // Old channel briefly recovers (clearReconnectState clears reconnectingRef) BEFORE rejoin ACK arrives
    mocks.rejoinRoom.mockResolvedValueOnce({ success: true });
    mocks.peerConnected = true;
    mocks.emitStatus('connected');

    // Host offer for negotiation 1 arrives while the original rejoin ACK is still in flight
    const offerNeg1 = {
      type: 'offer' as const,
      sdp: 'offer-sdp-neg-1',
      offerId: '1-1',
      negotiationId: 1,
    };
    mocks.mockSocket.trigger('signal', { signal: offerNeg1 });

    // Original rejoin ACK resolves -> replacement peer receives the buffered offer
    mocks.createPeer.mockClear();
    resolveRejoin({
      success: true,
      role: 'guest',
      peerPresent: true,
      alreadyNegotiating: false,
      negotiationId: 1,
    });
    await flushMicrotasks();

    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
      negotiationId: 1,
      initialSignals: [offerNeg1],
    });
  });

  it('defers a signaling retry while an active rejoin is already in flight and runs it after peerPresent: false', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-defer-retry', dealer: 0 });
      await flushMicrotasks();

      let resolveFirstRejoin!: (res: {
        success: boolean;
        role: 'guest';
        peerPresent: boolean;
        alreadyNegotiating: boolean;
      }) => void;
      mocks.rejoinRoom
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstRejoin = resolve;
            }),
        )
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 1,
        });

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();
      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);

      // A second disconnect arms a signaling retry timer while first rejoin is still in flight
      mocks.emitStatus('disconnected');
      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();

      // Must NOT have sent a duplicate rejoin while the first is still in flight
      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);

      // First rejoin settles with peerPresent: false -> deferred retry runs immediately
      resolveFirstRejoin({
        success: true,
        role: 'guest',
        peerPresent: false,
        alreadyNegotiating: false,
      });
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(2);
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('joins a pending negotiation on guest passive retry even while the old channel still reports open and bounds buffered signal bytes', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    // Old channel still reports open, first ACK was lost, retry returns alreadyNegotiating: true with negotiationId: 1
    mocks.peerConnected = true;
    mocks.signalingConnected = false;
    const oversizedOffer = {
      type: 'offer' as const,
      sdp: 'x'.repeat(100_000),
      offerId: 'big',
      negotiationId: 1,
    };
    const normalOffer = {
      type: 'offer' as const,
      sdp: 'offer-sdp-neg-1',
      offerId: '1-1',
      negotiationId: 1,
    };
    mocks.rejoinRoom.mockImplementationOnce(async () => {
      // Oversized signal exceeding byte budget must be dropped; normal offer stays buffered
      mocks.mockSocket.trigger('signal', { signal: oversizedOffer });
      mocks.mockSocket.trigger('signal', { signal: normalOffer });
      return {
        success: true,
        role: 'guest',
        peerPresent: true,
        alreadyNegotiating: true,
        negotiationId: 1,
      };
    });

    mocks.createPeer.mockClear();
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-open-old-channel', dealer: 0 });
    await flushMicrotasks();

    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
      negotiationId: 1,
      initialSignals: [normalOffer],
    });
  });

  it('preserves pending failedNegotiationId when a later rejoin failure replaces the retry timer', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-keep-failed-id', dealer: 0 });
      await flushMicrotasks();

      let rejectFirst!: (err: Error) => void;
      mocks.rejoinRoom
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 1,
        });

      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();

      // Replacement failure arms retry timer with failedNegotiationId: 0
      mocks.emitStatus('disconnected');
      // First in-flight rejoin rejects with no failedNegotiationId and replaces the timer -> must preserve 0
      rejectFirst(new Error('Rejoining room timed out'));
      await flushMicrotasks();

      await vi.advanceTimersByTimeAsync(1_000);
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenLastCalledWith(
        'ABCD',
        'guest',
        'tok-guest',
        expect.any(Number),
        { retry: true, failedNegotiationId: 0 },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts matching peer on non-retry passive restore when server returns alreadyNegotiating for an unstarted negotiation', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-passive-already', dealer: 0 });
    await flushMicrotasks();

    mocks.rejoinRoom.mockResolvedValueOnce({
      success: true,
      role: 'guest',
      peerPresent: true,
      alreadyNegotiating: true,
      negotiationId: 2,
    });
    mocks.createPeer.mockClear();

    // Signaling reconnect triggers a non-retry passive restore
    mocks.mockSocket.trigger('connect');
    await flushMicrotasks();

    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 2 });
  });

  it('forwards retry flag and failedNegotiationId when signaling reconnect advances a scheduled retry', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-connect-retry', dealer: 0 });
      await flushMicrotasks();

      // First rejoin starts negotiation 1
      mocks.rejoinRoom
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 1,
        })
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 2,
        });

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 1 });

      // Negotiation 1 fails -> arms scheduled retry with retry: true, failedNegotiationId: 1
      mocks.emitStatus('disconnected');

      // Signaling reconnects before the 1s retry timer fires -> must forward retry: true & failedNegotiationId: 1
      mocks.mockSocket.trigger('connect');
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenLastCalledWith(
        'ABCD',
        'guest',
        'tok-guest',
        expect.any(Number),
        { retry: true, failedNegotiationId: 1 },
      );
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores peer-reconnected notifications and late channel opens once the active monotonic reconnect deadline has passed', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-deadline-race', dealer: 0 });
      await flushMicrotasks();

      mocks.rejoinRoom.mockResolvedValueOnce({
        success: true,
        role: 'guest',
        peerPresent: false,
        alreadyNegotiating: false,
      });

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();
      expect(useGameStore.getState().connectionStatus).toBe('reconnecting');

      // A wall-clock jump forward must NOT expire the monotonic 18s budget
      vi.setSystemTime(Date.now() + 30_000);
      mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 4 });
      await flushMicrotasks();
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 4 });
      mocks.createPeer.mockClear();

      // Simulate monotonic clock advancing past the 18s deadline before the pending timeout callback fires
      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 5 });
        await flushMicrotasks();

        expect(mocks.createPeer).not.toHaveBeenCalled();

        // Late channel open after the 18s monotonic deadline must fail recovery instead of publishing 'connected'
        mocks.destroyPeer.mockClear();
        mocks.peerConnected = true;
        mocks.emitStatus('connected');
        expect(useGameStore.getState().connectionStatus).toBe('disconnected');
        expect(mocks.destroyPeer).toHaveBeenCalledTimes(1);
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects late rejoin acknowledgements arriving after the active monotonic reconnect deadline', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-rejoin-deadline', dealer: 0 });
      await flushMicrotasks();

      let resolveRejoin!: (res: {
        success: boolean;
        role: 'guest';
        peerPresent: boolean;
        alreadyNegotiating: boolean;
        negotiationId: number;
      }) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRejoin = resolve;
          }),
      );

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();

      // Advance monotonic clock past the 18s deadline before the timeout callback runs
      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        resolveRejoin({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 3,
        });
        await flushMicrotasks();

        expect(mocks.createPeer).not.toHaveBeenCalled();
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a late committed guest reconciliation ACK after the deadline as expired recovery', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;

      let resolveReconcile!: (res: {
        success: boolean;
        role: 'guest';
        peerPresent: boolean;
        alreadyNegotiating: boolean;
        negotiationId?: number;
      }) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReconcile = resolve;
          }),
      );

      mocks.createPeer.mockClear();
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-late-guest-ack', dealer: 0 });
      await flushMicrotasks();

      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        mocks.destroyPeer.mockClear();
        resolveReconcile({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 2,
        });
        await flushMicrotasks();

        expect(useGameStore.getState().gameState).not.toBeNull();
        expect(useGameStore.getState().connectionStatus).toBe('disconnected');
        expect(useGameStore.getState().connectionError).toBeNull();
        expect(mocks.createPeer).not.toHaveBeenCalled();
        expect(mocks.destroyPeer).toHaveBeenCalledTimes(1);
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebinds on signaling reconnect without forwarding stale retry metadata from a superseded negotiation', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-superseded-connect', dealer: 0 });
      await flushMicrotasks();

      let resolveFirstRejoin!: (res: {
        success: boolean;
        role: 'guest';
        peerPresent: boolean;
        alreadyNegotiating: boolean;
        negotiationId: number;
      }) => void;
      mocks.rejoinRoom
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstRejoin = resolve;
            }),
        )
        .mockResolvedValueOnce({
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: true,
          negotiationId: 1,
        });

      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.emitStatus('disconnected');
      await flushMicrotasks();
      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);

      // While first rejoin is in flight, a disconnect arms a scheduled retry for negotiation 0
      mocks.emitStatus('disconnected');

      // First rejoin resolves and starts newer negotiation 1 (advancing activeNegotiationIdRef to 1)
      resolveFirstRejoin({
        success: true,
        role: 'guest',
        peerPresent: true,
        alreadyNegotiating: false,
        negotiationId: 1,
      });
      await flushMicrotasks();
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 1 });

      // Signaling reconnects before the old 1s timer fires -> must still rebind the new socket
      // via rejoinRoom with retry: false and NO stale failedNegotiationId from negotiation 0
      mocks.mockSocket.trigger('connect');
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenCalledTimes(2);
      expect(mocks.rejoinRoom).toHaveBeenLastCalledWith(
        'ABCD',
        'guest',
        'tok-guest',
        expect.any(Number),
        { retry: false },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves guest opening state as disconnected if reconciliation times out after peer-reconnected proved the match started', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;

      let rejectReconcile!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReconcile = reject;
          }),
      );

      mocks.createPeer.mockClear();
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-reconnected-proof', dealer: 0 });
      await flushMicrotasks();

      // Host's peer-reconnected notification proves the server committed the match
      mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 2 });

      // Probe times out right at the reconciliation deadline
      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        mocks.destroyPeer.mockClear();
        rejectReconcile(new Error('Rejoining room timed out'));
        await flushMicrotasks();

        expect(useGameStore.getState().gameState).not.toBeNull();
        expect(useGameStore.getState().connectionStatus).toBe('disconnected');
        expect(useGameStore.getState().connectionError).toBeNull();
        expect(mocks.createPeer).not.toHaveBeenCalled();
        expect(mocks.destroyPeer).toHaveBeenCalledTimes(1);
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps guest confirmation pending on preserved disconnect and waits until the exact reconciliation deadline for start evidence', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = false;
      mocks.signalingConnected = false;

      let rejectReconcile!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReconcile = reject;
          }),
      );

      mocks.createPeer.mockClear();
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-preserved-tail', dealer: 0 });
      await flushMicrotasks();

      // Preserved disconnect while peer channel is closed must NOT mark 'disconnected'
      // or block a subsequent peer-reconnected notification during confirmation.
      mocks.mockSocket.trigger('peer-disconnected', { preserved: true });
      expect(useGameStore.getState().connectionStatus).toBe('connecting');

      // Probe fails with 180ms remaining before the 18s deadline: confirmation must stay open
      // without issuing another probe, and accept a peer-reconnected arriving 80ms later.
      const baseNow = performance.now();
      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(baseNow + 17_820);
      try {
        rejectReconcile(new Error('Rejoining room timed out'));
        await flushMicrotasks();

        // Still pending while waiting out the final 180ms
        expect(useGameStore.getState().gameState).toBeNull();
        expect(useGameStore.getState().connectionStatus).toBe('connecting');
        expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);

        // 80ms later (still within deadline), host's peer-reconnected arrives
        mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 2 });

        // Deadline expires after remaining 180ms -> preserves opening state as 'disconnected'
        await vi.advanceTimersByTimeAsync(180);
        await flushMicrotasks();

        expect(mocks.rejoinRoom).toHaveBeenCalledTimes(1);
        expect(useGameStore.getState().gameState).not.toBeNull();
        expect(useGameStore.getState().connectionStatus).toBe('disconnected');
        expect(useGameStore.getState().connectionError).toBeNull();
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('parks unconfirmed opening state on offline reconciliation expiry and resumes via token-based retry once online', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;

      let rejectReconcile!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReconcile = reject;
          }),
      );

      // Receive opening deal and a buffered host action while offline
      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-parked', dealer: 1 });
      mocks.emitMessage({ type: 'game-action', action: { type: 'bid-pass' }, seq: 1 });
      await flushMicrotasks();

      // Deadline expires with no server rejection and no peer-reconnected -> park opening state
      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        rejectReconcile(new Error('Rejoining room timed out'));
        await flushMicrotasks();
      } finally {
        nowSpy.mockRestore();
      }

      // Opening state is NOT applied until the server confirms, and credentials remain retained
      expect(useGameStore.getState().gameState).toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('connecting');
      expect(useGameStore.getState().roomCode).toBe('ABCD');
      expect(useGameStore.getState().reconnectToken).toBe('tok-guest');
      expect(useGameStore.getState().connectionError).toMatch(/retry/i);

      // Retrying while still offline throws and keeps the parked start intact
      mocks.connectSignaling.mockRejectedValueOnce(new Error('Still offline'));
      await expect(api.joinGame('ABCD')).rejects.toThrow('Still offline');
      expect(useGameStore.getState().gameState).toBeNull();

      // Once back online, retrying joinGame('ABCD') uses token-based rejoinRoom (not joinRoom)
      mocks.joinRoom.mockClear();
      mocks.createPeer.mockClear();
      const earlyOffer = {
        type: 'offer' as const,
        sdp: 'offer-sdp-neg-2',
        offerId: '2-1',
        negotiationId: 2,
      };
      mocks.rejoinRoom.mockImplementationOnce(async () => {
        mocks.mockSocket.trigger('signal', { signal: earlyOffer });
        return {
          success: true,
          role: 'guest',
          peerPresent: true,
          alreadyNegotiating: false,
          negotiationId: 2,
        };
      });

      await api.joinGame('ABCD');
      await flushMicrotasks();

      expect(mocks.joinRoom).not.toHaveBeenCalled();
      expect(mocks.rejoinRoom).toHaveBeenLastCalledWith(
        'ABCD',
        'guest',
        'tok-guest',
        8_000,
        { passive: false, retry: true },
      );
      // Opening state and buffered bid-pass are applied only after server confirmation
      expect(useGameStore.getState().gameState?.sequenceNumber).toBe(1);
      expect(useGameStore.getState().connectionStatus).toBe('reconnecting');
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
        negotiationId: 2,
        initialSignals: [earlyOffer],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to a fresh joinRoom when token-based retry learns the room never started', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;

      let rejectReconcile!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReconcile = reject;
          }),
      );

      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-never-started', dealer: 0 });
      await flushMicrotasks();

      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        rejectReconcile(new Error('Rejoining room timed out'));
        await flushMicrotasks();
      } finally {
        nowSpy.mockRestore();
      }

      mocks.joinRoom.mockClear();
      mocks.createPeer.mockClear();
      mocks.rejoinRoom.mockResolvedValueOnce({ success: false, error: 'Game has not started' });

      await api.joinGame('ABCD');
      await flushMicrotasks();

      expect(mocks.rejoinRoom).toHaveBeenLastCalledWith(
        'ABCD',
        'guest',
        'tok-guest',
        8_000,
        { passive: false, retry: true },
      );
      expect(mocks.joinRoom).toHaveBeenCalledWith('ABCD', undefined, expect.any(Function));
      expect(useGameStore.getState().gameState).toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('connecting');
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', { negotiationId: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps parked guest on retry screen across preserved disconnect and retains peer-reconnected arriving before opening applies', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;

      let rejectReconcile!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReconcile = reject;
          }),
      );

      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-parked-notice', dealer: 0 });
      await flushMicrotasks();

      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        rejectReconcile(new Error('Rejoining room timed out'));
        await flushMicrotasks();
      } finally {
        nowSpy.mockRestore();
      }

      // Preserved disconnect while parked must keep the connecting/retry screen intact
      mocks.mockSocket.trigger('peer-disconnected', { preserved: true });
      expect(useGameStore.getState().connectionStatus).toBe('connecting');

      // Token-based retry returns peerPresent: false, while peer-reconnected + offer arrive
      // before the continuation applies the parked opening state
      const offerNeg3 = {
        type: 'offer' as const,
        sdp: 'offer-sdp-neg-3',
        offerId: '3-1',
        negotiationId: 3,
      };
      mocks.createPeer.mockClear();
      mocks.rejoinRoom.mockImplementationOnce(async () => {
        mocks.mockSocket.trigger('peer-reconnected', { role: 'host', negotiationId: 3 });
        mocks.mockSocket.trigger('signal', { signal: offerNeg3 });
        return {
          success: true,
          role: 'guest',
          peerPresent: false,
          alreadyNegotiating: false,
        };
      });

      await api.joinGame('ABCD');
      await flushMicrotasks();

      expect(useGameStore.getState().gameState).not.toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('reconnecting');
      expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
        negotiationId: 3,
        initialSignals: [offerNeg3],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets provisional host state on peer-joined when a guest retries after a failed opening handshake', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    try {
      const api = usePeer();
      await api.hostGame();

      // Host opens data channel and deals provisional opening hand (unstarted on server)
      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      expect(useGameStore.getState().gameState).not.toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('connected');

      // Channel drops before guest receives/confirms opening; guest retries join-room -> server emits peer-joined
      mocks.createPeer.mockClear();
      mocks.peerConnected = false;
      mocks.mockSocket.trigger('peer-joined');

      expect(useGameStore.getState().gameState).toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('in-lobby');
      expect(mocks.createPeer).toHaveBeenCalledWith(true, 'ABCD', { negotiationId: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps remote room closure terminal if preserved: false arrives while a parked retry ACK is in flight', async () => {
    vi.useFakeTimers();
    try {
      const api = usePeer();
      await api.joinGame('ABCD');

      mocks.peerConnected = true;
      mocks.emitStatus('connected');
      mocks.signalingConnected = false;

      let rejectReconcile!: (err: Error) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectReconcile = reject;
          }),
      );

      mocks.emitMessage({ type: 'sync-seed', seed: 'seed-closed-mid-retry', dealer: 0 });
      await flushMicrotasks();

      const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 18_500);
      try {
        rejectReconcile(new Error('Rejoining room timed out'));
        await flushMicrotasks();
      } finally {
        nowSpy.mockRestore();
      }

      let resolveRetryRejoin!: (res: {
        success: boolean;
        role: 'guest';
        peerPresent: boolean;
        alreadyNegotiating: boolean;
        negotiationId: number;
      }) => void;
      mocks.rejoinRoom.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetryRejoin = resolve;
          }),
      );

      mocks.createPeer.mockClear();
      const retryPromise = api.joinGame('ABCD');
      await flushMicrotasks();

      // Host explicitly closes the room while the parked retry ACK is still in flight
      mocks.mockSocket.trigger('peer-disconnected', { preserved: false });
      expect(useGameStore.getState().connectionStatus).toBe('disconnected');

      // Late ACK resolves after the closure -> must NOT resurrect the closed room
      resolveRetryRejoin({
        success: true,
        role: 'guest',
        peerPresent: true,
        alreadyNegotiating: false,
        negotiationId: 2,
      });
      await retryPromise;
      await flushMicrotasks();

      expect(useGameStore.getState().gameState).toBeNull();
      expect(useGameStore.getState().connectionStatus).toBe('disconnected');
      expect(mocks.createPeer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps pending guest confirmation in control when the data channel drops before ACK resolves', async () => {
    const api = usePeer();
    await api.joinGame('ABCD');

    let resolveConfirm!: (value: 'confirmed' | 'rejected' | 'ambiguous') => void;
    mocks.confirmPeerConnected.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    mocks.peerConnected = true;
    mocks.emitStatus('connected');
    mocks.emitMessage({ type: 'sync-seed', seed: 'seed-keep-confirm', dealer: 1 });
    mocks.emitMessage({ type: 'game-action', action: { type: 'bid-pass' }, seq: 1 });

    // Channel drops while confirmation ACK is still in flight -> must NOT surface Retry error
    mocks.peerConnected = false;
    mocks.emitStatus('disconnected');
    expect(useGameStore.getState().connectionError).toBeNull();

    // Even a programmatic joinGame retry for the same room must not wipe pending confirmation
    mocks.joinRoom.mockClear();
    await api.joinGame('ABCD');
    expect(mocks.joinRoom).not.toHaveBeenCalled();

    // Confirmation resolves -> opening state and queued action are installed and recovery starts
    resolveConfirm('confirmed');
    await flushMicrotasks();

    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(1);
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting');
  });

  it('invalidates an in-flight fresh joinGame continuation when the host explicitly closes the room', async () => {
    const api = usePeer();

    let resolveJoin!: (res: { success: boolean; reconnectToken: string }) => void;
    mocks.joinRoom.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve;
        }),
    );

    mocks.createPeer.mockClear();
    const joinPromise = api.joinGame('ABCD');
    await flushMicrotasks();

    // Host closes room in the same batch before join-room continuation resumes
    mocks.mockSocket.trigger('peer-disconnected', { preserved: false });
    expect(useGameStore.getState().connectionStatus).toBe('disconnected');

    resolveJoin({ success: true, reconnectToken: 'tok-late' });
    await joinPromise;
    await flushMicrotasks();

    expect(useGameStore.getState().connectionStatus).toBe('disconnected');
    expect(mocks.createPeer).not.toHaveBeenCalled();
  });

  it('buffers host negotiation-0 offers arriving before joinGame installs the guest peer and checks attempt ownership', async () => {
    const api = usePeer();

    const earlyNeg0Offer = {
      type: 'offer' as const,
      sdp: 'offer-sdp-neg-0',
      offerId: '0-1',
      negotiationId: 0,
    };
    let capturedIsCurrent: (() => boolean) | undefined;
    mocks.joinRoom.mockImplementationOnce(
      async (_code: string, _timeoutMs?: number, isCurrent?: () => boolean) => {
        capturedIsCurrent = isCurrent;
        // Host offer arrives in the same transport payload as the join ACK before createPeer runs
        mocks.mockSocket.trigger('signal', { signal: earlyNeg0Offer });
        return { success: true, reconnectToken: 'tok-neg0' };
      },
    );

    mocks.createPeer.mockClear();
    await api.joinGame('ABCD');

    expect(capturedIsCurrent?.()).toBe(true);
    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ABCD', {
      negotiationId: 0,
      initialSignals: [earlyNeg0Offer],
    });

    // Leaving or starting a new session flips the previous attempt's ownership check to false
    api.cancelConnection();
    expect(capturedIsCurrent?.()).toBe(false);
  });

  it('ignores room A closure and stale room A signals while joining room B, but still cancels room B on room B closure', async () => {
    const api = usePeer();

    // Start joining ROOM B while room A's late closure and stale offer arrive on the same socket
    const staleRoomAOffer = {
      type: 'offer' as const,
      sdp: 'stale-room-a-offer',
      offerId: 'a-1',
    };
    const roomBOffer = {
      type: 'offer' as const,
      sdp: 'valid-room-b-offer',
      offerId: 'b-1',
      negotiationId: 0,
    };
    let resolveRoomB!: (res: { success: boolean; reconnectToken: string }) => void;
    let roomBIsCurrent: (() => boolean) | undefined;
    mocks.joinRoom.mockImplementationOnce(
      (_code: string, _timeoutMs?: number, isCurrent?: () => boolean) => {
        roomBIsCurrent = isCurrent;
        return new Promise((resolve) => {
          resolveRoomB = resolve;
        });
      },
    );

    mocks.createPeer.mockClear();
    const joinRoomBPromise = api.joinGame('ROOMB');
    await flushMicrotasks();

    // Room A closes and relays a stale signal -> must NOT cancel ROOM B or leak into initialSignals
    mocks.mockSocket.trigger('peer-disconnected', { preserved: false, roomCode: 'ROOMA' });
    mocks.mockSocket.trigger('signal', { roomCode: 'ROOMA', signal: staleRoomAOffer });
    mocks.mockSocket.trigger('signal', { roomCode: 'ROOMB', signal: roomBOffer });

    expect(roomBIsCurrent?.()).toBe(true);
    resolveRoomB({ success: true, reconnectToken: 'tok-b' });
    await joinRoomBPromise;
    await flushMicrotasks();

    expect(useGameStore.getState().roomCode).toBe('ROOMB');
    expect(useGameStore.getState().connectionStatus).toBe('connecting');
    expect(mocks.createPeer).toHaveBeenCalledWith(false, 'ROOMB', {
      negotiationId: 0,
      initialSignals: [roomBOffer],
    });

    // Now test that a closure for the pending target room (ROOM C) BEFORE its join ACK resolves DOES cancel ROOM C
    api.cancelConnection();
    let resolveRoomC!: (res: { success: boolean; reconnectToken: string }) => void;
    let roomCIsCurrent: (() => boolean) | undefined;
    mocks.joinRoom.mockImplementationOnce(
      (_code: string, _timeoutMs?: number, isCurrent?: () => boolean) => {
        roomCIsCurrent = isCurrent;
        return new Promise((resolve) => {
          resolveRoomC = resolve;
        });
      },
    );
    mocks.createPeer.mockClear();
    const joinRoomCPromise = api.joinGame('ROOMC');
    await flushMicrotasks();

    mocks.mockSocket.trigger('peer-disconnected', { preserved: false, roomCode: 'ROOMC' });
    expect(roomCIsCurrent?.()).toBe(false);
    resolveRoomC({ success: true, reconnectToken: 'tok-c' });
    await joinRoomCPromise;
    await flushMicrotasks();

    expect(useGameStore.getState().connectionStatus).toBe('disconnected');
    expect(mocks.createPeer).not.toHaveBeenCalled();
  });
});

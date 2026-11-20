import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../networking/peer', () => ({
  sendPeerMessage: vi.fn(),
}));

import { useGameStore } from '../gameStore';
import { sendPeerMessage } from '../../networking/peer';
import type { Mock } from 'vitest';

const mockedSend = sendPeerMessage as Mock;

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameState: null,
      connectionStatus: 'disconnected',
      connectionError: null,
      roomCode: null,
      isHost: false,
      localPlayer: 0,
    });
    mockedSend.mockClear();
  });

  it('initGame creates a state and broadcasts nothing', () => {
    useGameStore.getState().initGame('store-test', 0);
    const { gameState } = useGameStore.getState();
    expect(gameState).not.toBeNull();
    expect(gameState!.phase).toBe('bidding-round1');
    expect(gameState!.sequenceNumber).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('performAction applies locally and broadcasts with the new sequence number', () => {
    // Dealer 1: the local player (0) is the non-dealer and has the first turn.
    useGameStore.getState().initGame('store-test', 1);

    useGameStore.getState().performAction({ type: 'bid-take' });

    const { gameState } = useGameStore.getState();
    expect(gameState!.phase).toBe('playing');
    expect(gameState!.sequenceNumber).toBe(1);
    expect(mockedSend).toHaveBeenCalledWith({
      type: 'game-action',
      action: { type: 'bid-take' },
      seq: 1,
    });
  });

  it('performAction does not broadcast rejected actions', () => {
    // Dealer 0: the local player (0) is the dealer and does NOT have the turn.
    useGameStore.getState().initGame('store-test', 0);

    useGameStore.getState().performAction({ type: 'bid-take' });

    const { gameState } = useGameStore.getState();
    expect(gameState!.phase).toBe('bidding-round1');
    expect(gameState!.sequenceNumber).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('receiveAction applies a remote action when the sequence matches', () => {
    // Dealer 0: the remote player (1) is the non-dealer and has the first turn.
    useGameStore.getState().initGame('store-test', 0);

    useGameStore.getState().receiveAction({ type: 'bid-take' }, 1);

    const { gameState } = useGameStore.getState();
    expect(gameState!.phase).toBe('playing');
    expect(gameState!.sequenceNumber).toBe(1);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('receiveAction requests a resync and ignores out-of-order actions', () => {
    useGameStore.getState().initGame('store-test', 0);

    useGameStore.getState().receiveAction({ type: 'bid-take' }, 5);

    const { gameState } = useGameStore.getState();
    expect(gameState!.phase).toBe('bidding-round1');
    expect(gameState!.sequenceNumber).toBe(0);
    expect(mockedSend).toHaveBeenCalledWith({ type: 'resync-request' });
  });

  it('receiveGameState applies a full state from the same seed', () => {
    useGameStore.getState().initGame('store-test', 0);

    const advanced = structuredClone(useGameStore.getState().gameState!);
    advanced.sequenceNumber = 42;

    useGameStore.getState().receiveGameState(advanced);
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(42);
  });

  it('receiveGameState ignores states from a different seed', () => {
    useGameStore.getState().initGame('store-test', 0);

    const other = structuredClone(useGameStore.getState().gameState!);
    other.seed = 'other-seed';

    useGameStore.getState().receiveGameState(other);
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(0);
  });

  it('sendFullState broadcasts the current game state', () => {
    useGameStore.getState().initGame('store-test', 0);

    useGameStore.getState().sendFullState();
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game-state' }),
    );
    expect(mockedSend.mock.calls[0][0].state.seed).toBe('store-test');
  });

  it('receiveResumeGame hydrates a guest with no active game', () => {
    useGameStore.setState({ isHost: false, localPlayer: 1, gameState: null });
    const snapshot = (() => {
      useGameStore.getState().initGame('resume-store-test', 0);
      useGameStore.getState().receiveAction({ type: 'bid-take' }, 1);
      return structuredClone(useGameStore.getState().gameState!);
    })();

    useGameStore.setState({ isHost: false, localPlayer: 1, gameState: null });
    useGameStore.getState().receiveResumeGame(snapshot);

    expect(useGameStore.getState().gameState).toEqual(snapshot);
  });

  it('receiveResumeGame ignores resume messages when already in a game or when host', () => {
    useGameStore.getState().initGame('active-seed', 0);
    const foreign = structuredClone(useGameStore.getState().gameState!);
    foreign.seed = 'foreign-seed';
    foreign.sequenceNumber = 9;

    // Guest already in an active game ignores resume-game
    useGameStore.setState({ isHost: false, localPlayer: 1 });
    useGameStore.getState().receiveResumeGame(foreign);
    expect(useGameStore.getState().gameState!.seed).toBe('active-seed');

    // Host ignores resume-game even if gameState is null
    useGameStore.setState({ isHost: true, localPlayer: 0, gameState: null });
    useGameStore.getState().receiveResumeGame(foreign);
    expect(useGameStore.getState().gameState).toBeNull();
  });

  it('hydrateGame clears pendingResumeState and sets gameState', () => {
    useGameStore.getState().initGame('hydrate-seed', 0);
    const saved = structuredClone(useGameStore.getState().gameState!);
    useGameStore.setState({
      isHost: true,
      localPlayer: 0,
      gameState: null,
      pendingResumeState: saved,
    });

    useGameStore.getState().hydrateGame(saved);
    expect(useGameStore.getState().gameState).toEqual(saved);
    expect(useGameStore.getState().pendingResumeState).toBeNull();
  });
});

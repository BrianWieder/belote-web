import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../networking/peer', () => ({
  sendPeerMessage: vi.fn(() => true),
}));

import { useGameStore } from '../gameStore';
import { sendPeerMessage } from '../../networking/peer';
import type { GameState } from '../../game/types';
import type { Mock } from 'vitest';

const mockedSend = sendPeerMessage as Mock;

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameState: null,
      connectionStatus: 'connected',
      connectionError: null,
      roomCode: null,
      isHost: false,
      localPlayer: 0,
    });
    mockedSend.mockReset();
    mockedSend.mockReturnValue(true);
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

  it('receiveGameState rejects stale state and pushes back local newer state', () => {
    useGameStore.getState().initGame('store-test', 1);
    useGameStore.getState().performAction({ type: 'bid-take' });
    mockedSend.mockClear();

    const stale = structuredClone(useGameStore.getState().gameState!);
    stale.sequenceNumber = 0;

    useGameStore.getState().receiveGameState(stale);
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(1);
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'game-state',
        state: expect.objectContaining({ sequenceNumber: 1 }),
      }),
    );
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

  it('performAction refuses to apply or broadcast when disconnected', () => {
    useGameStore.getState().initGame('store-test', 1);
    useGameStore.setState({ connectionStatus: 'disconnected' });

    useGameStore.getState().performAction({ type: 'bid-take' });

    const { gameState } = useGameStore.getState();
    expect(gameState!.phase).toBe('bidding-round1');
    expect(gameState!.sequenceNumber).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('performAction refuses to mutate local state if sendPeerMessage returns false', () => {
    useGameStore.getState().initGame('store-test', 1);
    mockedSend.mockReturnValueOnce(false);

    useGameStore.getState().performAction({ type: 'bid-take' });

    const { gameState } = useGameStore.getState();
    expect(gameState!.phase).toBe('bidding-round1');
    expect(gameState!.sequenceNumber).toBe(0);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('nextRound bumps sequenceNumber, broadcasts seq, and blocks when disconnected', () => {
    useGameStore.getState().initGame('round-test', 0);
    const roundOver = structuredClone(useGameStore.getState().gameState!);
    roundOver.phase = 'round-over';
    roundOver.sequenceNumber = 33;
    useGameStore.setState({ gameState: roundOver, connectionStatus: 'disconnected' });

    useGameStore.getState().nextRound();
    expect(useGameStore.getState().gameState!.phase).toBe('round-over');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(33);
    expect(mockedSend).not.toHaveBeenCalled();

    useGameStore.setState({ connectionStatus: 'connected' });
    useGameStore.getState().nextRound();
    expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
    expect(mockedSend).toHaveBeenCalledWith({ type: 'new-round', seq: 34 });
  });

  it('receiveNextRound advances on matching or omitted seq and requests resync on mismatch', () => {
    useGameStore.getState().initGame('round-test', 0);
    const roundOver = structuredClone(useGameStore.getState().gameState!);
    roundOver.phase = 'round-over';
    roundOver.sequenceNumber = 33;

    // Mismatched seq triggers resync instead of advancing
    useGameStore.setState({ gameState: structuredClone(roundOver) });
    useGameStore.getState().receiveNextRound(40);
    expect(useGameStore.getState().gameState!.phase).toBe('round-over');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(33);
    expect(mockedSend).toHaveBeenCalledWith({ type: 'resync-request' });

    mockedSend.mockClear();

    // Matching seq advances cleanly
    useGameStore.getState().receiveNextRound(34);
    expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
    expect(mockedSend).not.toHaveBeenCalled();

    // Duplicate/simultaneous new-round with seq <= local is ignored without resync
    useGameStore.getState().receiveNextRound(34);
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
    expect(mockedSend).not.toHaveBeenCalled();

    // Receiving a future new-round while still behind in another phase requests resync
    useGameStore.getState().receiveNextRound(50);
    expect(mockedSend).toHaveBeenCalledWith({ type: 'resync-request' });

    mockedSend.mockClear();

    // Omitted seq remains backwards-compatible in round-over
    useGameStore.setState({ gameState: structuredClone(roundOver) });
    useGameStore.getState().receiveNextRound();
    expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('receiveGameState rejects malformed, stale, and post-game-over snapshots', () => {
    useGameStore.getState().initGame('store-test', 0);
    const current = structuredClone(useGameStore.getState().gameState!);
    current.sequenceNumber = 10;
    useGameStore.setState({ gameState: current });

    // Reject stale sequenceNumber
    const stale = structuredClone(current);
    stale.sequenceNumber = 9;
    useGameStore.getState().receiveGameState(stale);
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(10);

    // Reject malformed state even with matching seed and higher seq
    const malformed = {
      ...structuredClone(current),
      sequenceNumber: 20,
      hands: [current.hands[0]],
    } as unknown as GameState;
    useGameStore.getState().receiveGameState(malformed);
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(10);

    // Accept valid game-over resync when local game is still active
    const gameOver = structuredClone(current);
    gameOver.phase = 'game-over';
    gameOver.gameScore = [1020, 880];
    gameOver.sequenceNumber = 35;
    useGameStore.getState().receiveGameState(gameOver);
    expect(useGameStore.getState().gameState!.phase).toBe('game-over');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(35);

    // Reject any further resync once local game is already game-over
    const afterOver = structuredClone(gameOver);
    afterOver.phase = 'playing';
    afterOver.sequenceNumber = 36;
    useGameStore.getState().receiveGameState(afterOver);
    expect(useGameStore.getState().gameState!.phase).toBe('game-over');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(35);
  });
});

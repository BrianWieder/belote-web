import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../networking/peer', () => ({
  sendPeerMessage: vi.fn(() => true),
}));

import { useGameStore } from '../gameStore';
import { sendPeerMessage } from '../../networking/peer';
import { createInitialState } from '../../game/engine';
import { SAVED_GAME_STORAGE_KEY } from '../savedGame';
import type { GameState, PlayerID, RoundScore } from '../../game/types';
import type { Mock } from 'vitest';

const mockedSend = sendPeerMessage as Mock;

function makeRoundScore(): RoundScore {
  return {
    trickPoints: [100, 52],
    beloteBonus: [0, 0],
    lastTrickBonus: [10, 0],
    dedans: false,
    taker: 0,
    trumpSuit: 'hearts',
    finalPoints: [110, 52],
  };
}

function makeRoundOverState(
  seed = 'round-test',
  dealer: PlayerID = 0,
  roundsPlayed = 1,
  sequenceNumber = 33,
): GameState {
  const state = createInitialState(seed, dealer);
  state.phase = 'round-over';
  state.sequenceNumber = sequenceNumber;
  state.roundScores = Array.from({ length: roundsPlayed }, () => makeRoundScore());
  state.gameScore = [110 * roundsPlayed, 52 * roundsPlayed];
  return state;
}

function makeGameOverState(
  seed = 'match-test',
  dealer: PlayerID = 0,
  sequenceNumber = 65,
): GameState {
  const state = createInitialState(seed, dealer);
  state.phase = 'game-over';
  state.sequenceNumber = sequenceNumber;
  state.roundScores = [makeRoundScore()];
  state.gameScore = [1050, 720];
  return state;
}

describe('gameStore', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameState: null,
      pendingResumeState: null,
      hostGameSaved: false,
      connectionStatus: 'connected',
      connectionError: null,
      roomCode: null,
      isHost: false,
      localPlayer: 0,
      gameMode: 'p2p',
      botDifficulty: 'smart',
      roundReady: [false, false],
      rematchReady: [false, false],
      pendingRematchStart: null,
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

  it('nextRound requires mutual ready, bumps sequenceNumber on deal, and blocks when disconnected', () => {
    const roundOver = makeRoundOverState('round-test', 0, 1, 33);
    useGameStore.setState({
      gameState: roundOver,
      isHost: true,
      localPlayer: 0,
      connectionStatus: 'disconnected',
    });

    // Blocked when disconnected
    useGameStore.getState().nextRound();
    expect(useGameStore.getState().gameState!.phase).toBe('round-over');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(33);
    expect(useGameStore.getState().roundReady).toEqual([false, false]);
    expect(mockedSend).not.toHaveBeenCalled();

    // Blocked if sendPeerMessage returns false
    useGameStore.setState({ connectionStatus: 'connected' });
    mockedSend.mockReturnValueOnce(false);
    useGameStore.getState().nextRound();
    expect(useGameStore.getState().roundReady).toEqual([false, false]);

    // Connected: local ready sends round-ready and waits for opponent
    useGameStore.getState().nextRound();
    expect(useGameStore.getState().gameState!.phase).toBe('round-over');
    expect(useGameStore.getState().roundReady).toEqual([true, false]);
    expect(mockedSend).toHaveBeenLastCalledWith({ type: 'round-ready', round: 1 });

    // Opponent ready advances round and bumps sequenceNumber to 34
    useGameStore.getState().receiveRoundReady(1);
    expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');
    expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
    expect(useGameStore.getState().roundReady).toEqual([false, false]);
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

  describe('mutual round-over ready check', () => {
    it('waits for opponent when only local player clicks ready, then deals when opponent readies', () => {
      const roundOver = makeRoundOverState('round-sync', 0, 1, 33);
      useGameStore.setState({ gameState: roundOver, isHost: true, localPlayer: 0 });

      useGameStore.getState().nextRound();

      expect(useGameStore.getState().gameState!.phase).toBe('round-over');
      expect(useGameStore.getState().roundReady).toEqual([true, false]);
      expect(mockedSend).toHaveBeenCalledTimes(1);
      expect(mockedSend).toHaveBeenCalledWith({ type: 'round-ready', round: 1 });

      // Clicking again while already ready is a no-op
      useGameStore.getState().markRoundReady();
      expect(mockedSend).toHaveBeenCalledTimes(1);

      // Opponent sends round-ready for round 1 -> next round deals immediately
      useGameStore.getState().receiveRoundReady(1);

      const { gameState, roundReady } = useGameStore.getState();
      expect(gameState!.phase).toBe('bidding-round1');
      expect(gameState!.dealer).toBe(1);
      expect(gameState!.roundScores).toHaveLength(1);
      expect(gameState!.sequenceNumber).toBe(34);
      expect(roundReady).toEqual([false, false]);
    });

    it('marks opponent ready first and deals immediately when local player clicks ready second', () => {
      const roundOver = makeRoundOverState('round-sync-2', 1, 2, 66);
      useGameStore.setState({ gameState: roundOver, isHost: false, localPlayer: 1 });

      useGameStore.getState().receiveRoundReady(2);
      expect(useGameStore.getState().gameState!.phase).toBe('round-over');
      expect(useGameStore.getState().roundReady).toEqual([true, false]);
      expect(mockedSend).not.toHaveBeenCalled();

      useGameStore.getState().nextRound();

      const { gameState, roundReady } = useGameStore.getState();
      expect(gameState!.phase).toBe('bidding-round1');
      expect(gameState!.dealer).toBe(0);
      expect(gameState!.sequenceNumber).toBe(67);
      expect(roundReady).toEqual([false, false]);
      expect(mockedSend).toHaveBeenCalledWith({ type: 'round-ready', round: 2 });
    });

    it('ignores stale round-ready messages for mismatched rounds or non-round-over phases', () => {
      const roundOver = makeRoundOverState('round-stale', 0, 2, 66);
      useGameStore.setState({ gameState: roundOver, isHost: true, localPlayer: 0 });

      useGameStore.getState().receiveRoundReady(1);
      useGameStore.getState().receiveRoundReady(3);
      expect(useGameStore.getState().roundReady).toEqual([false, false]);

      useGameStore.getState().initGame('playing-phase', 0);
      useGameStore.getState().receiveRoundReady(0);
      expect(useGameStore.getState().roundReady).toEqual([false, false]);
    });

    it('does not revert an already-advanced round on a stale round-over snapshot and reconciles readiness on resync', () => {
      const roundOver = makeRoundOverState('round-resync-guard', 0, 1, 33);
      useGameStore.setState({ gameState: structuredClone(roundOver), isHost: true, localPlayer: 0 });

      // Both players ready -> host advances to round 2 (bidding-round1, seq 34, roundScores.length still 1)
      useGameStore.getState().nextRound();
      useGameStore.getState().receiveRoundReady(1);
      expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');
      expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
      expect(useGameStore.getState().gameState!.roundScores).toHaveLength(1);
      mockedSend.mockClear();

      // Stale round-over snapshot (seq 33, same roundScores.length) must NOT revert host to round-over
      useGameStore.getState().receiveGameState(structuredClone(roundOver));
      expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');
      expect(useGameStore.getState().gameState!.sequenceNumber).toBe(34);
      // Host pushes back its newer state so the lagging peer catches up
      expect(mockedSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'game-state',
          state: expect.objectContaining({ phase: 'bidding-round1', sequenceNumber: 34 }),
        }),
      );

      // Even a synthetic same-seq round-over snapshot cannot revert an active round
      const sameSeqStale = structuredClone(roundOver);
      sameSeqStale.sequenceNumber = 34;
      useGameStore.getState().receiveGameState(sameSeqStale);
      expect(useGameStore.getState().gameState!.phase).toBe('bidding-round1');

      // During same-round round-over resync, sendFullState and receiveGameState re-advertise local readiness
      useGameStore.setState({
        gameState: structuredClone(roundOver),
        roundReady: [true, false],
        localPlayer: 0,
      });
      mockedSend.mockClear();
      useGameStore.getState().sendFullState();
      expect(mockedSend).toHaveBeenNthCalledWith(1, { type: 'game-state', state: roundOver });
      expect(mockedSend).toHaveBeenNthCalledWith(2, { type: 'round-ready', round: 1 });

      mockedSend.mockClear();
      useGameStore.getState().receiveGameState(structuredClone(roundOver));
      expect(useGameStore.getState().roundReady).toEqual([true, false]);
      expect(mockedSend).toHaveBeenCalledWith({ type: 'round-ready', round: 1 });

      // Receiving an older snapshot while locally ready in round-over replies with full state + round-ready
      const olderSnapshot = structuredClone(roundOver);
      olderSnapshot.phase = 'playing';
      olderSnapshot.sequenceNumber = 32;
      mockedSend.mockClear();
      useGameStore.getState().receiveGameState(olderSnapshot);
      expect(mockedSend).toHaveBeenNthCalledWith(1, { type: 'game-state', state: roundOver });
      expect(mockedSend).toHaveBeenNthCalledWith(2, { type: 'round-ready', round: 1 });
    });
  });

  describe('live P2P rematch handshake', () => {
    it('host requests rematch, waits for guest, then starts new match with alternated dealer', () => {
      const gameOver = makeGameOverState('old-match-seed', 0, 120);
      useGameStore.setState({ gameState: gameOver, isHost: true, localPlayer: 0 });

      useGameStore.getState().requestRematch();
      expect(useGameStore.getState().gameState!.phase).toBe('game-over');
      expect(useGameStore.getState().rematchReady).toEqual([true, false]);
      expect(mockedSend).toHaveBeenCalledTimes(1);
      expect(mockedSend).toHaveBeenCalledWith({ type: 'rematch-ready' });

      // Guest accepts -> host initializes fresh match with dealer 1 and sends rematch-start
      useGameStore.getState().receiveRematchReady();

      const { gameState, rematchReady, roundReady } = useGameStore.getState();
      expect(gameState!.phase).toBe('bidding-round1');
      expect(gameState!.seed).not.toBe('old-match-seed');
      expect(gameState!.seed.length).toBeGreaterThan(0);
      expect(gameState!.dealer).toBe(1);
      expect(gameState!.gameScore).toEqual([0, 0]);
      expect(gameState!.roundScores).toEqual([]);
      expect(rematchReady).toEqual([false, false]);
      expect(roundReady).toEqual([false, false]);

      expect(mockedSend).toHaveBeenCalledTimes(2);
      expect(mockedSend).toHaveBeenLastCalledWith({
        type: 'rematch-start',
        seed: gameState!.seed,
        dealer: 1,
      });
    });

    it('host starts rematch immediately when guest requested first and alternates dealer from 1 to 0', () => {
      const gameOver = makeGameOverState('old-match-seed-2', 1, 120);
      useGameStore.setState({ gameState: gameOver, isHost: true, localPlayer: 0 });

      useGameStore.getState().receiveRematchReady();
      expect(useGameStore.getState().gameState!.phase).toBe('game-over');
      expect(useGameStore.getState().rematchReady).toEqual([false, true]);
      expect(mockedSend).not.toHaveBeenCalled();

      useGameStore.getState().requestRematch();

      const { gameState, rematchReady } = useGameStore.getState();
      expect(gameState!.phase).toBe('bidding-round1');
      expect(gameState!.dealer).toBe(0);
      expect(gameState!.seed).not.toBe('old-match-seed-2');
      expect(rematchReady).toEqual([false, false]);

      expect(mockedSend).toHaveBeenNthCalledWith(1, { type: 'rematch-ready' });
      expect(mockedSend).toHaveBeenNthCalledWith(2, {
        type: 'rematch-start',
        seed: gameState!.seed,
        dealer: 0,
      });
    });

    it('guest waits for rematch-start even when both are ready, then initializes new game and resets flags', () => {
      const gameOver = makeGameOverState('guest-old-seed', 0, 120);
      useGameStore.setState({ gameState: gameOver, isHost: false, localPlayer: 1 });

      // Guest ignores unilateral rematch-start before clicking rematch
      useGameStore.getState().receiveRematchStart('unrequested-seed', 1);
      expect(useGameStore.getState().gameState!.phase).toBe('game-over');

      useGameStore.getState().receiveRematchReady();
      expect(useGameStore.getState().rematchReady).toEqual([true, false]);

      useGameStore.getState().requestRematch();
      expect(useGameStore.getState().rematchReady).toEqual([true, true]);
      expect(useGameStore.getState().gameState!.phase).toBe('game-over');
      expect(mockedSend).toHaveBeenCalledTimes(1);
      expect(mockedSend).toHaveBeenCalledWith({ type: 'rematch-ready' });

      useGameStore.getState().receiveRematchStart('rematch-seed-xyz', 1);

      const { gameState, rematchReady, roundReady } = useGameStore.getState();
      expect(gameState!.phase).toBe('bidding-round1');
      expect(gameState!.seed).toBe('rematch-seed-xyz');
      expect(gameState!.dealer).toBe(1);
      expect(gameState!.gameScore).toEqual([0, 0]);
      expect(rematchReady).toEqual([false, false]);
      expect(roundReady).toEqual([false, false]);
    });

    it('ignores rematch actions outside game-over, when disconnected, and host ignores rematch-start', () => {
      useGameStore.getState().initGame('active-match', 0);
      useGameStore.setState({ isHost: true, localPlayer: 0 });

      useGameStore.getState().requestRematch();
      useGameStore.getState().receiveRematchReady();
      expect(useGameStore.getState().rematchReady).toEqual([false, false]);
      expect(mockedSend).not.toHaveBeenCalled();

      const gameOver = makeGameOverState('host-match', 0, 120);
      useGameStore.setState({
        gameState: gameOver,
        isHost: true,
        localPlayer: 0,
        connectionStatus: 'disconnected',
      });
      useGameStore.getState().requestRematch();
      expect(useGameStore.getState().rematchReady).toEqual([false, false]);
      expect(mockedSend).not.toHaveBeenCalled();

      useGameStore.setState({ connectionStatus: 'connected' });
      useGameStore.getState().receiveRematchStart('spoofed-seed', 1);
      expect(useGameStore.getState().gameState!.phase).toBe('game-over');
      expect(useGameStore.getState().gameState!.seed).toBe('host-match');
    });

    it('resets rematchReady on initGame, hydrateGame, and resetConnection', () => {
      const gameOver = makeGameOverState('reset-rematch', 0, 120);
      useGameStore.setState({ gameState: gameOver, rematchReady: [true, false] });

      useGameStore.getState().initGame('new-match', 0);
      expect(useGameStore.getState().rematchReady).toEqual([false, false]);

      useGameStore.setState({ rematchReady: [false, true] });
      useGameStore.getState().hydrateGame(makeRoundOverState());
      expect(useGameStore.getState().rematchReady).toEqual([false, false]);

      useGameStore.setState({ rematchReady: [true, false] });
      useGameStore.getState().resetConnection();
      expect(useGameStore.getState().rematchReady).toEqual([false, false]);
      expect(useGameStore.getState().pendingRematchStart).toBeNull();
    });

    it('replays rematch-start across reconnects/resyncs until the guest is confirmed on the new match', () => {
      const oldGameOver = makeGameOverState('old-match-seed', 0, 120);
      useGameStore.setState({
        gameState: structuredClone(oldGameOver),
        isHost: true,
        localPlayer: 0,
      });

      // Both players ready -> host enters new match (dealer 1) and retains pendingRematchStart
      useGameStore.getState().requestRematch();
      useGameStore.getState().receiveRematchReady();

      const newMatch = useGameStore.getState().gameState!;
      expect(newMatch.seed).not.toBe('old-match-seed');
      expect(newMatch.dealer).toBe(1);
      expect(useGameStore.getState().pendingRematchStart).toEqual({
        previousSeed: 'old-match-seed',
        seed: newMatch.seed,
        dealer: 1,
      });

      // Reconnect triggers sendFullState on host -> replays rematch-start BEFORE game-state
      mockedSend.mockClear();
      useGameStore.getState().sendFullState();
      expect(mockedSend).toHaveBeenNthCalledWith(1, {
        type: 'rematch-start',
        seed: newMatch.seed,
        dealer: 1,
      });
      expect(mockedSend).toHaveBeenNthCalledWith(2, {
        type: 'game-state',
        state: newMatch,
      });

      // If guest still sends rematch-ready or old-seed game-over snapshot, host replays rematch-start
      // without letting the mismatched seed overwrite the new match
      mockedSend.mockClear();
      useGameStore.getState().receiveRematchReady();
      expect(mockedSend).toHaveBeenNthCalledWith(1, {
        type: 'rematch-start',
        seed: newMatch.seed,
        dealer: 1,
      });

      mockedSend.mockClear();
      useGameStore.getState().receiveGameState(structuredClone(oldGameOver));
      expect(useGameStore.getState().gameState!.seed).toBe(newMatch.seed);
      expect(mockedSend).toHaveBeenNthCalledWith(1, {
        type: 'rematch-start',
        seed: newMatch.seed,
        dealer: 1,
      });

      // Unrelated foreign seed is still strictly ignored
      mockedSend.mockClear();
      const unrelated = makeGameOverState('foreign-seed', 0, 120);
      useGameStore.getState().receiveGameState(unrelated);
      expect(mockedSend).not.toHaveBeenCalled();

      // Once guest sends a valid action on the new match (or matching-seed state), pendingRematchStart clears
      // (dealer is 1, so host acts first; after host acts, guest acts, or guest sends matching-seed state)
      useGameStore.getState().performAction({ type: 'bid-pass' });
      useGameStore.getState().receiveAction({ type: 'bid-take' }, 2);
      expect(useGameStore.getState().pendingRematchStart).toBeNull();

      // Subsequent sendFullState only sends game-state (no redundant rematch-start)
      mockedSend.mockClear();
      useGameStore.getState().sendFullState();
      expect(mockedSend).toHaveBeenCalledTimes(1);
      expect(mockedSend).toHaveBeenCalledWith({
        type: 'game-state',
        state: useGameStore.getState().gameState,
      });
    });
  });

  describe('solo bot mode', () => {
    it('startBotGame initializes a local match without sending peer messages or overwriting saved P2P host game', () => {
      const storeMap = new Map<string, string>();
      const fakeStorage = {
        getItem: (k: string) => storeMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storeMap.set(k, v);
        },
        removeItem: (k: string) => {
          storeMap.delete(k);
        },
        clear: () => storeMap.clear(),
        key: () => null,
        length: 0,
      } as Storage;

      const existingSnapshot = JSON.stringify({ sentinel: 'p2p-saved-match' });
      fakeStorage.setItem(SAVED_GAME_STORAGE_KEY, existingSnapshot);
      vi.stubGlobal('window', { localStorage: fakeStorage });

      try {
        useGameStore.getState().startBotGame('casual');
        const state = useGameStore.getState();

        expect(state.gameMode).toBe('bot');
        expect(state.botDifficulty).toBe('casual');
        expect(state.localPlayer).toBe(0);
        expect(state.isHost).toBe(false);
        expect(state.connectionStatus).toBe('connected');
        expect(state.gameState).not.toBeNull();
        expect(state.hostGameSaved).toBe(false);
        expect(mockedSend).not.toHaveBeenCalled();

        // Human or bot action in bot mode sends no peer messages and keeps saved P2P game untouched.
        const initialDealer = state.gameState!.dealer;
        if (state.gameState!.currentPlayer === 0) {
          useGameStore.getState().performAction({ type: 'bid-take' });
        } else {
          useGameStore.getState().performBotAction({ type: 'bid-take' });
        }
        expect(useGameStore.getState().gameState!.phase).toBe('playing');
        expect(mockedSend).not.toHaveBeenCalled();
        expect(fakeStorage.getItem(SAVED_GAME_STORAGE_KEY)).toBe(existingSnapshot);

        // Stale P2P initGame/hydrateGame/receiveAction calls cannot clobber an active bot game.
        const botSeed = useGameStore.getState().gameState!.seed;
        useGameStore.getState().initGame('stale-p2p-seed', 0);
        expect(useGameStore.getState().gameMode).toBe('bot');
        expect(useGameStore.getState().gameState!.seed).toBe(botSeed);

        // Rematch alternates dealer immediately.
        useGameStore.getState().startBotGame('casual');
        expect(useGameStore.getState().gameState!.dealer).toBe(initialDealer === 0 ? 1 : 0);
        expect(mockedSend).not.toHaveBeenCalled();
        expect(fakeStorage.getItem(SAVED_GAME_STORAGE_KEY)).toBe(existingSnapshot);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('nextRound and requestRematch advance immediately in bot mode without waiting for remote peer', () => {
      useGameStore.getState().startBotGame('smart', 1);
      const gs = structuredClone(useGameStore.getState().gameState!);
      gs.phase = 'round-over';
      const prevSeq = gs.sequenceNumber;
      useGameStore.setState({ gameState: gs });

      useGameStore.getState().nextRound();
      const updated = useGameStore.getState().gameState!;
      expect(updated.phase).toBe('bidding-round1');
      expect(updated.dealer).toBe(0);
      expect(updated.sequenceNumber).toBe(prevSeq + 1);
      expect(useGameStore.getState().roundReady).toEqual([false, false]);
      expect(mockedSend).not.toHaveBeenCalled();

      // Rematch from game-over in bot mode starts a fresh match with alternated dealer in one click.
      const over = structuredClone(updated);
      over.phase = 'game-over';
      const overSeed = over.seed;
      useGameStore.setState({ gameState: over });

      useGameStore.getState().requestRematch();
      const rematched = useGameStore.getState().gameState!;
      expect(rematched.phase).toBe('bidding-round1');
      expect(rematched.seed).not.toBe(overSeed);
      expect(rematched.dealer).toBe(1);
      expect(useGameStore.getState().rematchReady).toEqual([false, false]);
      expect(mockedSend).not.toHaveBeenCalled();
    });
  });
});

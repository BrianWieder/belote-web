// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

vi.mock('../../networking/peer', () => ({
  sendPeerMessage: vi.fn(() => true),
}));

import { createInitialState, applyAction } from '../../game/engine';
import { getPlayableCards } from '../../game/validation';
import { useGameStore } from '../../store/gameStore';
import { useGame, usePlayableCards } from '../useGame';

describe('useGame and usePlayableCards', () => {
  beforeEach(() => {
    useGameStore.getState().resetConnection();
  });

  afterEach(() => {
    cleanup();
    useGameStore.getState().resetConnection();
  });

  it('blocks bidding and playing actions when disconnected in p2p mode or off-turn', () => {
    const initial = createInitialState('use-game-guard', 0);
    // Player 1 is non-dealer and acts first.
    useGameStore.setState({
      gameMode: 'p2p',
      connectionStatus: 'disconnected',
      localPlayer: 1,
      gameState: initial,
    });

    const { result, rerender } = renderHook(() => useGame());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isMyTurn).toBe(true);

    act(() => {
      result.current.bidTake();
      result.current.bidPass();
      result.current.bidChoose('hearts');
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);

    // Connected, but opponent's turn (localPlayer = 0 while currentPlayer = 1)
    useGameStore.setState({ connectionStatus: 'connected', localPlayer: 0 });
    rerender();
    expect(result.current.isConnected).toBe(true);
    expect(result.current.isMyTurn).toBe(false);

    act(() => {
      result.current.bidTake();
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);
  });

  it('applies bidTake, bidPass, bidChoose, and playCard when connected on local turn', () => {
    // Non-Jack seed so both pass -> round 2 -> choose suit works cleanly
    const initial = createInitialState('test', 0);
    useGameStore.setState({
      gameMode: 'p2p',
      connectionStatus: 'connected',
      localPlayer: 1,
      gameState: initial,
    });

    const { result, rerender } = renderHook(() => useGame());

    act(() => {
      result.current.bidPass();
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(1);

    // Switch localPlayer to 0 to pass round 1 into round 2
    useGameStore.setState({ localPlayer: 0 });
    rerender();
    act(() => {
      result.current.bidPass();
    });
    expect(useGameStore.getState().gameState?.phase).toBe('bidding-round2');

    // Player 1 chooses an alternate suit in round 2
    useGameStore.setState({ localPlayer: 1 });
    rerender();
    const excludedSuit = useGameStore.getState().gameState!.trumpCard!.suit;
    const altSuit = excludedSuit === 'hearts' ? 'spades' : 'hearts';

    act(() => {
      result.current.bidChoose(altSuit);
    });
    const playingState = useGameStore.getState().gameState!;
    expect(playingState.phase).toBe('playing');
    expect(playingState.trumpSuit).toBe(altSuit);

    const cardToPlay = result.current.playableCards[0];
    act(() => {
      result.current.playCard(cardToPlay);
    });
    expect(useGameStore.getState().gameState?.currentTrick.cards[1]).toEqual(cardToPlay);
  });

  it('treats bot mode as connected even when connectionStatus is disconnected', () => {
    const initial = createInitialState('bot-connected-test', 1);
    // Dealer is 1 -> localPlayer 0 acts first
    useGameStore.setState({
      gameMode: 'bot',
      connectionStatus: 'disconnected',
      localPlayer: 0,
      gameState: initial,
    });

    const { result } = renderHook(() => useGame());
    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.bidTake();
    });
    expect(useGameStore.getState().gameState?.phase).toBe('playing');
  });

  it('usePlayableCards returns empty array outside playing and caches per GameState reference', () => {
    const initial = createInitialState('playable-cache-test', 0);
    useGameStore.setState({
      gameMode: 'bot',
      localPlayer: 1,
      gameState: initial,
    });

    const { result, rerender } = renderHook(() => usePlayableCards());
    expect(result.current).toEqual([]);

    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    useGameStore.setState({ gameState: playing });
    rerender();

    const firstResult = result.current;
    expect(firstResult).toEqual(getPlayableCards(playing));

    // Re-rendering with the exact same GameState reference returns the cached array reference
    rerender();
    expect(result.current).toBe(firstResult);
  });
});

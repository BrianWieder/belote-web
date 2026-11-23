// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createInitialState, applyAction } from '../../game/engine';
import { getPlayableCards } from '../../game/validation';
import { cardToString } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { useBotPlayer } from '../useBotPlayer';

describe('useBotPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.getState().resetConnection();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useGameStore.getState().resetConnection();
  });

  it('schedules and performs a bot action after 600ms when it is the bot turn', () => {
    const initial = createInitialState('bot-hook-bid', 0);
    // Dealer is 0 (local player), so bot (player 1) acts first in bidding-round1.
    useGameStore.setState({
      gameMode: 'bot',
      botDifficulty: 'smart',
      localPlayer: 0,
      gameState: initial,
    });

    renderHook(() => useBotPlayer());

    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(1);
  });

  it('waits 850ms on post-trick leads before the bot plays the next card', () => {
    let state = createInitialState('bot-hook-post-trick', 0);
    state = applyAction(state, state.currentPlayer, { type: 'bid-take' });
    // Complete trick 1 with a known winner = bot (player 1)
    const p1Lead = getPlayableCards(state)[0];
    state = applyAction(state, state.currentPlayer, {
      type: 'play-card',
      card: cardToString(p1Lead),
    });
    const p0Follow = getPlayableCards(state)[0];
    state = applyAction(state, state.currentPlayer, {
      type: 'play-card',
      card: cardToString(p0Follow),
    });

    // Ensure bot (player 1) leads trick 2 regardless of who won trick 1
    const postTrickState = structuredClone(state);
    postTrickState.currentPlayer = 1;
    postTrickState.currentTrick = { cards: [null, null], leader: 1 };
    const seqBefore = postTrickState.sequenceNumber;

    useGameStore.setState({
      gameMode: 'bot',
      botDifficulty: 'casual',
      localPlayer: 0,
      gameState: postTrickState,
    });

    renderHook(() => useBotPlayer());

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(seqBefore);

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(seqBefore + 1);
  });

  it('does nothing in p2p mode, on local player turn, or in non-active phases', () => {
    const initial = createInitialState('bot-hook-noop', 0);
    useGameStore.setState({
      gameMode: 'p2p',
      localPlayer: 0,
      gameState: initial,
    });

    const { rerender } = renderHook(() => useBotPlayer());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);

    // Local player's turn in bot mode (dealer is 1 -> local player 0 acts first)
    const localTurn = createInitialState('bot-hook-local', 1);
    useGameStore.setState({
      gameMode: 'bot',
      localPlayer: 0,
      gameState: localTurn,
    });
    rerender();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);

    // Round-over phase in bot mode
    const roundOver = structuredClone(initial);
    roundOver.phase = 'round-over';
    roundOver.currentPlayer = 1;
    useGameStore.setState({ gameState: roundOver });
    rerender();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);
  });

  it('cancels pending bot timer on unmount without mutating state', () => {
    const initial = createInitialState('bot-hook-unmount', 0);
    useGameStore.setState({
      gameMode: 'bot',
      botDifficulty: 'smart',
      localPlayer: 0,
      gameState: initial,
    });

    const { unmount } = renderHook(() => useBotPlayer());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useGameStore.getState().gameState?.sequenceNumber).toBe(0);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

vi.mock('../../audio/sounds', () => ({
  playBeloteFanfare: vi.fn(),
  playCardSnap: vi.fn(),
  playDealSound: vi.fn(),
  playTrickWin: vi.fn(),
  playTurnPing: vi.fn(),
}));

import {
  playBeloteFanfare,
  playCardSnap,
  playDealSound,
  playTrickWin,
  playTurnPing,
} from '../../audio/sounds';
import { createInitialState, applyAction } from '../../game/engine';
import { getPlayableCards } from '../../game/validation';
import { cardToString } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { DEFAULT_DOCUMENT_TITLE } from '../gameFeedbackTransitions';
import { useGameFeedback } from '../useGameFeedback';

describe('useGameFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useGameStore.getState().resetConnection();
    document.title = DEFAULT_DOCUMENT_TITLE;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useGameStore.getState().resetConnection();
    document.title = DEFAULT_DOCUMENT_TITLE;
  });

  it('plays opening deal sound once per seed/round and avoids duplicate riffle on remount', () => {
    const initial = createInitialState('feedback-initial-deal-1', 0);
    useGameStore.setState({ gameState: initial, localPlayer: 0 });

    const first = renderHook(() => useGameFeedback());
    expect(playDealSound).toHaveBeenCalledTimes(1);
    first.unmount();

    // Mounting again with the same seed and roundScores.length (like React StrictMode) skips duplicate deal sound
    const second = renderHook(() => useGameFeedback());
    expect(playDealSound).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('plays cardSnap, delayed turnPing, and delayed trickWin on state transitions', () => {
    const initial = createInitialState('feedback-transitions-1', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    // Player 1 leads trick 1; local player is 0.
    useGameStore.setState({ gameState: playing, localPlayer: 0 });

    renderHook(() => useGameFeedback());
    vi.clearAllMocks();

    // Player 1 plays lead card -> cardSnap immediately, turnPing after 120ms for local player 0
    const p1Card = getPlayableCards(playing)[0];
    const afterLead = applyAction(playing, 1, {
      type: 'play-card',
      card: cardToString(p1Card),
    });
    act(() => {
      useGameStore.setState({ gameState: afterLead });
    });

    expect(playCardSnap).toHaveBeenCalledTimes(1);
    expect(playTurnPing).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(playTurnPing).toHaveBeenCalledTimes(1);

    // Local player 0 completes trick -> cardSnap immediately, trickWin after 130ms
    vi.clearAllMocks();
    const p0Card = getPlayableCards(afterLead)[0];
    const afterTrick = applyAction(afterLead, 0, {
      type: 'play-card',
      card: cardToString(p0Card),
    });
    act(() => {
      useGameStore.setState({ gameState: afterTrick });
    });

    expect(playCardSnap).toHaveBeenCalledTimes(1);
    expect(playTrickWin).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(playTrickWin).toHaveBeenCalledTimes(1);
    expect(playBeloteFanfare).not.toHaveBeenCalled();
  });

  it('updates document.title when hidden on local turn and restores title on unmount', () => {
    const initial = createInitialState('feedback-title-1', 0);
    // Player 1 is currentPlayer
    useGameStore.setState({ gameState: initial, localPlayer: 1 });

    let isHidden = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isHidden,
    });

    const { unmount } = renderHook(() => useGameFeedback());
    expect(document.title).not.toBe(DEFAULT_DOCUMENT_TITLE);

    // Tab becomes visible -> title resets to default
    isHidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE);

    // Hide again, then unmount -> title resets to default
    isHidden = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(document.title).not.toBe(DEFAULT_DOCUMENT_TITLE);

    unmount();
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE);
  });

  it('clears scheduled sound timers on unmount', () => {
    const initial = createInitialState('feedback-cleanup-1', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    useGameStore.setState({ gameState: playing, localPlayer: 0 });

    const { unmount } = renderHook(() => useGameFeedback());
    vi.clearAllMocks();

    const p1Card = getPlayableCards(playing)[0];
    const afterLead = applyAction(playing, 1, {
      type: 'play-card',
      card: cardToString(p1Card),
    });
    act(() => {
      useGameStore.setState({ gameState: afterLead });
    });

    // Unmount before the 120ms turnPing delay fires
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(playTurnPing).not.toHaveBeenCalled();
  });
});

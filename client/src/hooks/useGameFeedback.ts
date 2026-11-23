import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  playBeloteFanfare,
  playCardSnap,
  playDealSound,
  playTrickWin,
  playTurnPing,
} from '../audio/sounds';
import {
  DEFAULT_DOCUMENT_TITLE,
  detectGameFeedbackEvents,
  getTurnDocumentTitle,
} from './gameFeedbackTransitions';

// Prevents StrictMode dev double-mount from playing the initial deal riffle twice.
let lastInitialDealKey: string | null = null;

/**
 * Coordinates synthesized Web Audio game feedback and browser tab title turn
 * alerts by subscribing directly to `useGameStore` transitions.
 * Mount once inside `GameBoard`.
 */
export function useGameFeedback(): void {
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (delayMs: number, fn: () => void) => {
      if (delayMs <= 0) {
        fn();
        return;
      }
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, delayMs);
      timers.add(id);
    };

    const syncDocumentTitle = () => {
      if (typeof document === 'undefined') return;
      const { gameState, localPlayer } = useGameStore.getState();
      document.title = getTurnDocumentTitle(
        gameState,
        localPlayer,
        document.hidden,
      );
    };

    // Play the opening deal sound once when GameBoard first mounts on a brand-new game.
    const initial = useGameStore.getState();
    if (initial.gameState) {
      const initialEvents = detectGameFeedbackEvents(
        null,
        initial.gameState,
        initial.localPlayer,
      );
      if (initialEvents.deal) {
        const dealKey = `${initial.gameState.seed}:${initial.gameState.roundScores.length}`;
        if (lastInitialDealKey !== dealKey) {
          lastInitialDealKey = dealKey;
          playDealSound();
        }
      }
    }

    syncDocumentTitle();

    const unsubscribe = useGameStore.subscribe((state, prevState) => {
      syncDocumentTitle();

      const events = detectGameFeedbackEvents(
        prevState.gameState,
        state.gameState,
        state.localPlayer,
      );

      if (events.deal) {
        playDealSound();
      }
      if (events.cardSnap) {
        playCardSnap();
      }
      if (events.belote) {
        schedule(events.cardSnap ? 60 : 0, () => {
          playBeloteFanfare();
        });
      }
      if (events.trickWin) {
        const wonByLocal = events.trickWin.wonByLocal;
        schedule(events.cardSnap ? 130 : 0, () => {
          playTrickWin(wonByLocal);
        });
      }
      if (events.turnPing) {
        const delay = events.deal ? 220 : events.cardSnap ? 120 : 0;
        schedule(delay, () => {
          playTurnPing();
        });
      }
    });

    const handleVisibilityChange = () => {
      syncDocumentTitle();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      unsubscribe();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.title = DEFAULT_DOCUMENT_TITLE;
      }
      for (const id of timers) {
        clearTimeout(id);
      }
      timers.clear();
    };
  }, []);
}

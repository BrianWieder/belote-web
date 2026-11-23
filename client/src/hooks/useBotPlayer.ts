import { useEffect } from 'react';
import { chooseBotAction } from '../game/bot';
import type { Phase, PlayerID } from '../game/types';
import { useGameStore } from '../store/gameStore';

const BOT_ACTION_DELAY_MS = 600;
const BOT_POST_TRICK_DELAY_MS = 850;

const BOT_ACTIVE_PHASES = new Set<Phase>([
  'bidding-round1',
  'bidding-round2',
  'bidding-forced',
  'playing',
]);

export function useBotPlayer() {
  const gameMode = useGameStore((s) => s.gameMode);
  const localPlayer = useGameStore((s) => s.localPlayer);
  const gameState = useGameStore((s) => s.gameState);

  const botPlayer: PlayerID = localPlayer === 0 ? 1 : 0;
  const shouldAct =
    gameMode === 'bot' &&
    gameState !== null &&
    BOT_ACTIVE_PHASES.has(gameState.phase) &&
    gameState.currentPlayer === botPlayer;

  const sequenceNumber = gameState?.sequenceNumber ?? -1;
  const phase = gameState?.phase;
  const tricksCount = gameState?.tricks.length ?? 0;
  const isPostTrickLead =
    phase === 'playing' &&
    tricksCount > 0 &&
    gameState?.currentTrick.cards[0] === null &&
    gameState?.currentTrick.cards[1] === null;

  useEffect(() => {
    if (!shouldAct || sequenceNumber < 0) return;

    const delay = isPostTrickLead ? BOT_POST_TRICK_DELAY_MS : BOT_ACTION_DELAY_MS;
    const timer = setTimeout(() => {
      const store = useGameStore.getState();
      if (
        store.gameMode !== 'bot' ||
        !store.gameState ||
        store.gameState.sequenceNumber !== sequenceNumber ||
        store.gameState.currentPlayer !== botPlayer ||
        !BOT_ACTIVE_PHASES.has(store.gameState.phase)
      ) {
        return;
      }

      const action = chooseBotAction(store.gameState, botPlayer, store.botDifficulty);
      store.performBotAction(action);
    }, delay);

    return () => clearTimeout(timer);
  }, [shouldAct, sequenceNumber, botPlayer, isPostTrickLead]);
}

import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import type { Card, Suit } from '../game/types';
import { cardToString } from '../game/types';

export function useGame() {
  const {
    gameState,
    localPlayer,
    performAction,
    nextRound,
    isMyTurn,
    getPlayableCards,
  } = useGameStore();

  const playCard = useCallback((card: Card) => {
    if (!isMyTurn()) return;
    performAction({ type: 'play-card', card: cardToString(card) });
  }, [performAction, isMyTurn]);

  const bidTake = useCallback(() => {
    if (!isMyTurn()) return;
    performAction({ type: 'bid-take' });
  }, [performAction, isMyTurn]);

  const bidPass = useCallback(() => {
    if (!isMyTurn()) return;
    performAction({ type: 'bid-pass' });
  }, [performAction, isMyTurn]);

  const bidChoose = useCallback((suit: Suit) => {
    if (!isMyTurn()) return;
    performAction({ type: 'bid-choose', suit });
  }, [performAction, isMyTurn]);

  return {
    gameState,
    localPlayer,
    playCard,
    bidTake,
    bidPass,
    bidChoose,
    nextRound,
    isMyTurn: isMyTurn(),
    playableCards: getPlayableCards(),
  };
}

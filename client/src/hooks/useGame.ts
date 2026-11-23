import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import type { Card, Suit } from '../game/types';
import { cardToString } from '../game/types';

export function useGame() {
  const {
    gameState,
    connectionStatus,
    localPlayer,
    performAction,
    nextRound,
    isMyTurn,
    getPlayableCards,
  } = useGameStore();

  const isConnected = connectionStatus === 'connected';

  const playCard = useCallback((card: Card) => {
    if (!isConnected || !isMyTurn()) return;
    performAction({ type: 'play-card', card: cardToString(card) });
  }, [isConnected, performAction, isMyTurn]);

  const bidTake = useCallback(() => {
    if (!isConnected || !isMyTurn()) return;
    performAction({ type: 'bid-take' });
  }, [isConnected, performAction, isMyTurn]);

  const bidPass = useCallback(() => {
    if (!isConnected || !isMyTurn()) return;
    performAction({ type: 'bid-pass' });
  }, [isConnected, performAction, isMyTurn]);

  const bidChoose = useCallback((suit: Suit) => {
    if (!isConnected || !isMyTurn()) return;
    performAction({ type: 'bid-choose', suit });
  }, [isConnected, performAction, isMyTurn]);

  return {
    gameState,
    localPlayer,
    isConnected,
    playCard,
    bidTake,
    bidPass,
    bidChoose,
    nextRound,
    isMyTurn: isMyTurn(),
    playableCards: getPlayableCards(),
  };
}

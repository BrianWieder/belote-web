import { useCallback, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { getPlayableCards } from '../game/validation';
import type { Card, GameState, Suit } from '../game/types';
import { cardToString } from '../game/types';

const EMPTY_CARDS: Card[] = [];
const playableCardsCache = new WeakMap<GameState, Card[]>();

function getCachedPlayableCards(gameState: GameState | null): Card[] {
  if (!gameState || gameState.phase !== 'playing') return EMPTY_CARDS;
  let cached = playableCardsCache.get(gameState);
  if (!cached) {
    cached = getPlayableCards(gameState);
    playableCardsCache.set(gameState, cached);
  }
  return cached;
}

export function usePlayableCards(): Card[] {
  const gameState = useGameStore((s) => s.gameState);
  return useMemo(() => getCachedPlayableCards(gameState), [gameState]);
}

export function useGame() {
  const gameState = useGameStore((s) => s.gameState);
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const localPlayer = useGameStore((s) => s.localPlayer);
  const roundReady = useGameStore((s) => s.roundReady);
  const rematchReady = useGameStore((s) => s.rematchReady);
  const performAction = useGameStore((s) => s.performAction);
  const nextRound = useGameStore((s) => s.nextRound);
  const requestRematch = useGameStore((s) => s.requestRematch);
  const isMyTurnFn = useGameStore((s) => s.isMyTurn);

  const isConnected = connectionStatus === 'connected';

  const playCard = useCallback((card: Card) => {
    if (!isConnected || !isMyTurnFn()) return;
    performAction({ type: 'play-card', card: cardToString(card) });
  }, [isConnected, performAction, isMyTurnFn]);

  const bidTake = useCallback(() => {
    if (!isConnected || !isMyTurnFn()) return;
    performAction({ type: 'bid-take' });
  }, [isConnected, performAction, isMyTurnFn]);

  const bidPass = useCallback(() => {
    if (!isConnected || !isMyTurnFn()) return;
    performAction({ type: 'bid-pass' });
  }, [isConnected, performAction, isMyTurnFn]);

  const bidChoose = useCallback((suit: Suit) => {
    if (!isConnected || !isMyTurnFn()) return;
    performAction({ type: 'bid-choose', suit });
  }, [isConnected, performAction, isMyTurnFn]);

  const isMyTurn = gameState !== null && gameState.currentPlayer === localPlayer;

  return {
    gameState,
    localPlayer,
    roundReady,
    rematchReady,
    isConnected,
    playCard,
    bidTake,
    bidPass,
    bidChoose,
    nextRound,
    requestRematch,
    isMyTurn,
    get playableCards(): Card[] {
      return getCachedPlayableCards(gameState);
    },
  };
}

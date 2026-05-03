import { useGame } from '../hooks/useGame';
import { Card } from './Card';
import type { PlayerID } from '../game/types';

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export function PlayArea() {
  const { gameState, localPlayer } = useGame();
  if (!gameState || gameState.phase !== 'playing') return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const trick = gameState.currentTrick;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Trump indicator */}
      {gameState.trumpSuit && (
        <div className="text-sm text-green-300 mb-1">
          Trump: <span className={gameState.trumpSuit === 'hearts' || gameState.trumpSuit === 'diamonds' ? 'text-red-400' : 'text-white'}>
            {SUIT_SYMBOLS[gameState.trumpSuit]}
          </span>
          {gameState.taker !== null && (
            <span className="ml-2">
              ({gameState.taker === localPlayer ? 'You' : 'Opponent'} took)
            </span>
          )}
        </div>
      )}

      {/* Trick count */}
      <div data-testid="trick-counter" className="text-xs text-green-400">
        Trick {gameState.tricks.length + 1}/16
      </div>

      {/* Play area - opponent card on top, player card on bottom */}
      <div data-testid="play-area" className="flex flex-col items-center gap-3 sm:gap-4 bg-green-700/50 rounded-xl px-6 py-4 sm:px-12 sm:py-6 min-h-24 sm:min-h-36">
        {/* Opponent's played card */}
        <div className="h-[3.75rem] sm:h-24">
          {trick.cards[opponent] ? (
            <Card card={trick.cards[opponent]} />
          ) : (
            <div className="w-10 h-[3.75rem] sm:w-16 sm:h-24 rounded-lg border-2 border-dashed border-green-600 flex items-center justify-center text-green-500 text-xs">
              {gameState.currentPlayer === opponent ? '...' : ''}
            </div>
          )}
        </div>

        {/* Player's played card */}
        <div className="h-[3.75rem] sm:h-24">
          {trick.cards[localPlayer] ? (
            <Card card={trick.cards[localPlayer]} />
          ) : (
            <div className="w-10 h-[3.75rem] sm:w-16 sm:h-24 rounded-lg border-2 border-dashed border-green-600 flex items-center justify-center text-green-500 text-xs">
              {gameState.currentPlayer === localPlayer ? 'Your turn' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Score display */}
      <div className="flex gap-6 text-sm text-green-300">
        <span>You: {gameState.tricksWon[localPlayer].length / 2} tricks</span>
        <span>Opp: {gameState.tricksWon[opponent].length / 2} tricks</span>
      </div>
    </div>
  );
}

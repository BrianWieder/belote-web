import { useGame } from '../hooks/useGame';
import { Card } from './Card';
import type { PlayerID } from '../game/types';

export function OpponentHand() {
  const { gameState, localPlayer } = useGame();
  if (!gameState) return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const count = gameState.hands[opponent].length;
  const mid = (count - 1) / 2;

  return (
    <div
      role="img"
      aria-label={`Opponent holds ${count} ${count === 1 ? 'card' : 'cards'} in hand`}
      className="min-h-11 tall-sm:min-h-12 ultra-short:min-h-9 flex items-center justify-center"
    >
      <div className="flex justify-center items-center">
        {Array.from({ length: count }).map((_, i) => {
          const offset = i - mid;
          const deg = offset * 2.2;
          const lift = Math.abs(offset) * 1.2;
          return (
            <div
              key={i}
              style={{
                transform: `translateY(${lift}px) rotate(${deg}deg)`,
              }}
              className={i > 0 ? '-ml-2 sm:-ml-1.5' : ''}
            >
              <Card card={{ suit: 'spades', rank: '7' }} faceDown size="xs" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

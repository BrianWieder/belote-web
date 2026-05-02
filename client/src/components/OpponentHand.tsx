import { useGame } from '../hooks/useGame';
import { Card } from './Card';
import type { PlayerID } from '../game/types';

export function OpponentHand() {
  const { gameState, localPlayer } = useGame();
  if (!gameState) return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const count = gameState.hands[opponent].length;

  return (
    <div className="flex justify-center gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <Card
          key={i}
          card={{ suit: 'spades', rank: '7' }}
          faceDown
          small
        />
      ))}
    </div>
  );
}

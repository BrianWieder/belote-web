import { useGame } from '../hooks/useGame';
import { Card } from './Card';
import type { Card as CardType } from '../game/types';
import { cardToString } from '../game/types';

export function Hand() {
  const { gameState, localPlayer, playCard, playableCards, isMyTurn, canAnnounceBelote, announceBelote } = useGame();
  if (!gameState) return null;

  const hand = gameState.hands[localPlayer];
  const isPlaying = gameState.phase === 'playing';

  const playableSet = new Set(playableCards.map(c => cardToString(c)));

  const handleCardClick = (card: CardType) => {
    if (!isMyTurn || !isPlaying) return;
    if (!playableSet.has(cardToString(card))) return;

    // Auto-announce belote if applicable
    if (canAnnounceBelote(card)) {
      announceBelote();
    }

    playCard(card);
  };

  // Sort hand by suit, then by rank
  const suitOrder = ['spades', 'hearts', 'clubs', 'diamonds'];
  const rankOrder = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];
  const sorted = [...hand].sort((a, b) => {
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
  });

  return (
    <div className="flex flex-wrap justify-center gap-0.5 sm:gap-2 px-1 sm:px-2">
      {sorted.map((card) => {
        const key = cardToString(card);
        const canPlay = isPlaying && isMyTurn && playableSet.has(key);

        return (
          <Card
            key={key}
            card={card}
            playable={canPlay}
            onClick={() => handleCardClick(card)}
          />
        );
      })}
    </div>
  );
}

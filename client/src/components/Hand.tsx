import { useGame } from '../hooks/useGame';
import { Card } from './Card';
import type { Card as CardType, Rank, Suit } from '../game/types';
import { cardToString } from '../game/types';

const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const PLAIN_RANK_ORDER: Rank[] = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];
const TRUMP_RANK_ORDER: Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];

export function Hand() {
  const {
    gameState,
    localPlayer,
    playCard,
    playableCards,
    isMyTurn,
    canAnnounceBelote,
    announceBelote,
  } = useGame();
  if (!gameState) return null;

  const hand = gameState.hands[localPlayer];
  const isPlaying = gameState.phase === 'playing';
  const trumpSuit = gameState.trumpSuit;

  const playableSet = new Set(playableCards.map((c) => cardToString(c)));

  const handleCardClick = (card: CardType) => {
    if (!isMyTurn || !isPlaying) return;
    if (!playableSet.has(cardToString(card))) return;

    if (canAnnounceBelote(card)) {
      announceBelote();
    }

    playCard(card);
  };

  // Sort hand in alternating black/red suit order, and by true Belote trick-taking strength within each suit
  const sorted = [...hand].sort((a, b) => {
    const suitDiff = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    const ranks = a.suit === trumpSuit ? TRUMP_RANK_ORDER : PLAIN_RANK_ORDER;
    return ranks.indexOf(a.rank) - ranks.indexOf(b.rank);
  });

  return (
    <div
      aria-label="Your hand"
      className="min-h-[4.6rem] sm:min-h-[6.5rem] flex items-center justify-center px-0.5 sm:px-3"
    >
      <div className="flex flex-nowrap sm:flex-wrap justify-center sm:gap-2">
        {sorted.map((card, index) => {
          const key = cardToString(card);
          const canPlay = isPlaying && isMyTurn && playableSet.has(key);
          const shouldDim = isPlaying && isMyTurn && !canPlay;
          const isTrump = Boolean(trumpSuit && card.suit === trumpSuit);

          return (
            <div key={key} className={index > 0 ? '-ml-1.5 sm:ml-0' : ''}>
              <Card
                card={card}
                playable={canPlay}
                dimmed={shouldDim}
                isTrump={isTrump}
                onClick={() => handleCardClick(card)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

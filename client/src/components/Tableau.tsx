import { useGame } from '../hooks/useGame';
import { Card } from './Card';
import type { Card as CardType, PlayerID, TableauSlot } from '../game/types';
import { cardToString } from '../game/types';

interface TableauProps {
  player: PlayerID;
}

export function Tableau({ player }: TableauProps) {
  const { gameState, localPlayer, playCard, playableCards, isMyTurn, canAnnounceBelote, announceBelote } = useGame();
  if (!gameState) return null;

  const tableau = gameState.tableau[player];
  const isLocal = player === localPlayer;
  const isPlaying = gameState.phase === 'playing';

  const playableSet = new Set(playableCards.map(c => cardToString(c)));

  const handleCardClick = (card: CardType) => {
    if (!isLocal || !isMyTurn || !isPlaying) return;
    if (!playableSet.has(cardToString(card))) return;

    if (canAnnounceBelote(card)) {
      announceBelote();
    }
    playCard(card);
  };

  return (
    <div data-testid={`tableau-${player}`} className="flex justify-center gap-1 sm:gap-3">
      {tableau.map((slot: TableauSlot, i: number) => {
        const isEmpty = !slot.faceDown && !slot.faceUp;
        if (isEmpty) {
          return <div key={i} className="w-10 h-14 sm:w-12 sm:h-[4.25rem]" />;
        }

        const faceUpCard = slot.faceUp;
        const canPlay = isLocal && isPlaying && isMyTurn && faceUpCard
          ? playableSet.has(cardToString(faceUpCard))
          : false;

        return (
          <div key={i} className="relative w-10 h-20 sm:w-12 sm:h-24">
            {/* Face-down card underneath */}
            {slot.faceDown && (
              <div className="absolute top-0 left-0">
                <Card card={{ suit: 'spades', rank: '7' }} faceDown small />
              </div>
            )}
            {/* Face-up card on top, offset down slightly */}
            {faceUpCard && (
              <div className={`absolute ${slot.faceDown ? 'top-4 sm:top-5' : 'top-0'} left-0`}>
                <Card
                  card={faceUpCard}
                  playable={canPlay}
                  small
                  onClick={() => handleCardClick(faceUpCard)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

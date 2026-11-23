import { useGame, usePlayableCards } from '../hooks/useGame';
import { Card } from './Card';
import type { Card as CardType, PlayerID, TableauSlot } from '../game/types';
import { cardToString } from '../game/types';

interface TableauProps {
  player: PlayerID;
}

export function Tableau({ player }: TableauProps) {
  const {
    gameState,
    localPlayer,
    isConnected,
    playCard,
    isMyTurn,
  } = useGame();
  const playableCards = usePlayableCards();
  if (!gameState) return null;

  const tableau = gameState.tableau[player];
  const isLocal = player === localPlayer;
  const isPlaying = gameState.phase === 'playing';
  const canAct = isLocal && isPlaying && isMyTurn && isConnected;

  const playableSet = new Set(playableCards.map((c) => cardToString(c)));

  const handleCardClick = (card: CardType) => {
    if (!canAct) return;
    if (!playableSet.has(cardToString(card))) return;

    playCard(card);
  };

  return (
    <div
      data-testid={`tableau-${player}`}
      className="flex justify-center gap-2 sm:gap-3.5"
    >
      {tableau.map((slot: TableauSlot, i: number) => {
        const isEmpty = !slot.faceDown && !slot.faceUp;
        if (isEmpty) {
          return (
            <div
              key={i}
              aria-hidden="true"
              className="w-11 h-[5rem] tall-sm:w-14 tall-sm:h-[5.9rem] ultra-short:h-[4.35rem] flex items-center justify-center"
            >
              <div className="w-11 h-[4.25rem] tall-sm:w-14 tall-sm:h-20 ultra-short:h-[3.85rem] rounded-lg border border-dashed border-[#efe9dc]/12 bg-[#0b1f16]/20" />
            </div>
          );
        }

        const faceUpCard = slot.faceUp;
        const canPlay =
          canAct && faceUpCard
            ? playableSet.has(cardToString(faceUpCard))
            : false;
        const shouldDim = isLocal && isPlaying && isMyTurn && !canPlay;
        const isTrump = Boolean(
          faceUpCard && gameState.trumpSuit && faceUpCard.suit === gameState.trumpSuit,
        );

        return (
          <div
            key={i}
            className="relative w-11 h-[5rem] tall-sm:w-14 tall-sm:h-[5.9rem] ultra-short:h-[4.35rem]"
          >
            {/* Buried face-down card */}
            {slot.faceDown && (
              <div className="absolute top-0 left-0">
                <Card card={{ suit: 'spades', rank: '7' }} faceDown size="sm" />
              </div>
            )}

            {/* Exposed face-up card */}
            {faceUpCard && (
              <div
                className={`absolute ${
                  slot.faceDown
                    ? 'top-3 tall-sm:top-3.5 ultra-short:top-2'
                    : 'top-1 tall-sm:top-1.5 ultra-short:top-0.5'
                } left-0`}
              >
                <Card
                  card={faceUpCard}
                  playable={canPlay}
                  dimmed={shouldDim}
                  isTrump={isTrump}
                  size="sm"
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

import type { Card as CardType, Suit } from '../game/types';
import { SUIT_NAMES, isRedSuit } from './suits';

interface SuitIconProps {
  suit: Suit;
  className?: string;
}

export function SuitIcon({ suit, className = 'w-4 h-4' }: SuitIconProps) {
  switch (suit) {
    case 'hearts':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      );
    case 'diamonds':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M12 2C14.4 6.4 17.6 9.6 22 12c-4.4 2.4-7.6 5.6-10 10C9.6 17.6 6.4 14.4 2 12 6.4 9.6 9.6 6.4 12 2z" />
        </svg>
      );
    case 'clubs':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M12 2.5a4.3 4.3 0 0 1 3.92 6.06A4.4 4.4 0 0 1 21 12.9a4.4 4.4 0 0 1-6.58 3.82c.33 1.88 1.18 3.4 2.43 4.28H7.15c1.25-.88 2.1-2.4 2.43-4.28A4.4 4.4 0 0 1 3 12.9a4.4 4.4 0 0 1 5.08-4.34A4.3 4.3 0 0 1 12 2.5z" />
        </svg>
      );
    case 'spades':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M12 2C7.5 7.4 3 10.9 3 14.6a4.6 4.6 0 0 0 4.6 4.6c1.5 0 2.8-.7 3.6-1.8-.25 1.7-1.05 3.1-2.3 3.85h6.2c-1.25-.75-2.05-2.15-2.3-3.85.8 1.1 2.1 1.8 3.6 1.8A4.6 4.6 0 0 0 21 14.6C21 10.9 16.5 7.4 12 2z" />
        </svg>
      );
  }
}

type CardSize = 'xs' | 'sm' | 'md';

interface CardProps {
  card: CardType;
  playable?: boolean;
  dimmed?: boolean;
  faceDown?: boolean;
  small?: boolean;
  size?: CardSize;
  isTrump?: boolean;
  decorative?: boolean;
  onClick?: () => void;
}

const SIZE_CLASSES: Record<CardSize, string> = {
  xs: 'w-8 h-11 rounded-md',
  sm: 'w-11 h-[4.25rem] sm:w-14 sm:h-20 rounded-lg',
  md: 'w-[3.1rem] h-[4.5rem] sm:w-[4.5rem] sm:h-[6.3rem] rounded-lg sm:rounded-xl',
};

export function Card({
  card,
  playable = false,
  dimmed = false,
  faceDown = false,
  small = false,
  size,
  isTrump = false,
  decorative = false,
  onClick,
}: CardProps) {
  const resolvedSize: CardSize = size ?? (small ? 'sm' : 'md');
  const sizeClass = SIZE_CLASSES[resolvedSize];

  if (faceDown) {
    return (
      <div
        aria-hidden="true"
        className={`${sizeClass} playing-card-back p-[3px] sm:p-1 select-none`}
      >
        <div className="w-full h-full rounded-[4px] sm:rounded-[6px] playing-card-back-inner flex items-center justify-center">
          <div className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 rotate-45 border border-[#d4a84b]/60 bg-[#d4a84b]/15" />
        </div>
      </div>
    );
  }

  const red = isRedSuit(card.suit);
  const inkColor = red ? 'text-[#b8262a]' : 'text-[#191c20]';
  const isCourt = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
  const isAce = card.rank === 'A';

  const indexRankSize =
    resolvedSize === 'sm'
      ? 'text-[10px] sm:text-xs leading-[0.95]'
      : 'text-[11px] sm:text-[15px] leading-[0.95]';
  const cornerPipSize =
    resolvedSize === 'sm'
      ? 'w-2 h-2 sm:w-2.5 sm:h-2.5'
      : 'w-2 h-2 sm:w-3 sm:h-3';
  const centerPipSize =
    resolvedSize === 'sm'
      ? 'w-3.5 h-3.5 sm:w-5 sm:h-5'
      : isAce
        ? 'w-4 h-4 sm:w-7 sm:h-7'
        : 'w-3.5 h-3.5 sm:w-6 sm:h-6';

  const innerContent = (
    <>
      {/* Subtle inner frame on court cards or trump highlight */}
      {(isCourt || isTrump) && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[3px] sm:inset-[5px] rounded-[5px] sm:rounded-[7px] border ${
            isTrump
              ? 'border-[#d4a84b]/55'
              : red
                ? 'border-[#b8262a]/20'
                : 'border-[#191c20]/15'
          }`}
        />
      )}

      {/* Top-left index */}
      <span className="relative z-10 self-start flex flex-col items-center leading-none">
        <span className={`font-display font-bold tracking-tight ${indexRankSize}`}>
          {card.rank}
        </span>
        <SuitIcon suit={card.suit} className={`${cornerPipSize} mt-[1px]`} />
      </span>

      {/* Center pip / medallion */}
      <span className="relative z-10 my-auto flex items-center justify-center">
        {isAce ? (
          <span
            className={`flex items-center justify-center rounded-full p-0.5 sm:p-1.5 border ${
              red ? 'border-[#b8262a]/25' : 'border-[#191c20]/20'
            }`}
          >
            <SuitIcon suit={card.suit} className={centerPipSize} />
          </span>
        ) : (
          <SuitIcon suit={card.suit} className={centerPipSize} />
        )}
      </span>

      {/* Bottom-right mirrored index */}
      <span
        aria-hidden="true"
        className="relative z-10 self-end flex flex-col items-center leading-none rotate-180"
      >
        <span className={`font-display font-bold tracking-tight ${indexRankSize}`}>
          {card.rank}
        </span>
        <SuitIcon suit={card.suit} className={`${cornerPipSize} mt-[1px]`} />
      </span>
    </>
  );

  const cardClasses = `
    ${sizeClass}
    playing-card overflow-hidden
    flex flex-col items-center justify-between
    px-1 py-[3px] sm:p-1.5
    select-none
    ${playable ? 'playing-card-playable' : 'cursor-default'}
    ${dimmed && !playable ? 'playing-card-dimmed' : ''}
    ${inkColor}
  `;

  if (decorative) {
    return (
      <div aria-hidden="true" className={cardClasses}>
        {innerContent}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`card-${card.rank}-${card.suit}`}
      data-playable={playable || undefined}
      aria-label={`${card.rank} of ${SUIT_NAMES[card.suit]}`}
      onClick={onClick}
      disabled={!playable}
      className={cardClasses}
    >
      {innerContent}
    </button>
  );
}

interface SuitButtonProps {
  suit: Suit;
  onClick: () => void;
  disabled?: boolean;
  'data-testid'?: string;
}

export function SuitButton({
  suit,
  onClick,
  disabled = false,
  'data-testid': testId,
}: SuitButtonProps) {
  const red = isRedSuit(suit);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={`Choose ${SUIT_NAMES[suit]} as trump`}
      className={`
        w-15 h-16 sm:w-18 sm:h-20 rounded-xl
        playing-card
        flex flex-col items-center justify-center gap-1
        select-none
        ${
          disabled
            ? 'opacity-35 cursor-not-allowed grayscale-[35%]'
            : 'playing-card-playable'
        }
        ${red ? 'text-[#b8262a]' : 'text-[#191c20]'}
      `}
    >
      <SuitIcon suit={suit} className="w-6 h-6 sm:w-7 sm:h-7" />
      <span className="text-[10px] sm:text-[11px] font-semibold tracking-tight text-[#3d382e]">
        {SUIT_NAMES[suit]}
      </span>
    </button>
  );
}

import type { Card as CardType, Suit } from '../game/types';

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLORS: Record<Suit, string> = {
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
  clubs: 'text-gray-900',
  spades: 'text-gray-900',
};

interface CardProps {
  card: CardType;
  playable?: boolean;
  faceDown?: boolean;
  small?: boolean;
  onClick?: () => void;
}

export function Card({ card, playable = false, faceDown = false, small = false, onClick }: CardProps) {
  if (faceDown) {
    return (
      <div className={`
        ${small ? 'w-10 h-14' : 'w-10 h-[3.75rem] sm:w-16 sm:h-24'}
        rounded-lg bg-blue-800 border-2 border-blue-900
        flex items-center justify-center
        shadow-md select-none
      `}>
        <div className={`${small ? 'text-lg' : 'text-lg sm:text-2xl'} text-blue-400`}>✦</div>
      </div>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const colorClass = SUIT_COLORS[card.suit];

  return (
    <button
      data-testid={`card-${card.rank}-${card.suit}`}
      data-playable={playable || undefined}
      onClick={onClick}
      disabled={!playable}
      className={`
        ${small ? 'w-10 h-14 text-xs' : 'w-10 h-[3.75rem] text-xs sm:w-16 sm:h-24 sm:text-sm'}
        rounded-lg bg-white border-2 shadow-md
        flex flex-col items-center justify-between p-1
        transition-all duration-150 select-none
        ${playable
          ? 'border-yellow-400 hover:border-yellow-500 hover:-translate-y-2 active:-translate-y-1 cursor-pointer hover:shadow-lg'
          : 'border-gray-300 opacity-90 cursor-default'
        }
        ${colorClass}
      `}
    >
      <div className="self-start font-bold leading-none">{card.rank}</div>
      <div className={small ? 'text-lg' : 'text-lg sm:text-2xl'}>{suitSymbol}</div>
      <div className="self-end font-bold leading-none rotate-180">{card.rank}</div>
    </button>
  );
}

interface SuitButtonProps {
  suit: Suit;
  onClick: () => void;
  disabled?: boolean;
  'data-testid'?: string;
}

export function SuitButton({ suit, onClick, disabled = false, 'data-testid': testId }: SuitButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`
        w-12 h-12 sm:w-14 sm:h-14 rounded-lg border-2 text-xl sm:text-2xl
        flex items-center justify-center
        transition-colors
        ${disabled
          ? 'border-gray-300 bg-gray-100 opacity-50 cursor-default'
          : 'border-gray-400 bg-white hover:bg-gray-50 hover:border-gray-600 cursor-pointer'
        }
        ${SUIT_COLORS[suit]}
      `}
    >
      {SUIT_SYMBOLS[suit]}
    </button>
  );
}

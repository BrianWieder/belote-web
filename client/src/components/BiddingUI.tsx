import { useGame } from '../hooks/useGame';
import { Card, SuitButton } from './Card';
import type { Suit } from '../game/types';

const ALL_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export function BiddingUI() {
  const { gameState, bidTake, bidPass, bidChoose, isMyTurn, isConnected } = useGame();
  if (!gameState) return null;

  const isRound1 = gameState.phase === 'bidding-round1';
  const isRound2 = gameState.phase === 'bidding-round2';
  const isForced = gameState.phase === 'bidding-forced';
  const trumpCard = gameState.trumpCard;
  const jackForced = isRound1 && trumpCard?.rank === 'J';

  return (
    <div className="tapis-ring rounded-2xl px-6 py-5 sm:px-9 sm:py-6 flex flex-col items-center gap-4 max-w-md w-full">
      {trumpCard && (
        <div className="flex flex-col items-center text-center">
          <p className="text-xs sm:text-sm text-[#a4bba9] mb-2.5">
            {isRound1
              ? jackForced
                ? 'Jack turned up — non-dealer must take'
                : 'Take with this trump suit?'
              : isForced
                ? 'All passed — choose any suit for trump'
                : 'Choose another suit for trump'}
          </p>
          <Card card={trumpCard} decorative />
        </div>
      )}

      {isForced && !trumpCard && (
        <p className="text-xs sm:text-sm text-[#a4bba9] text-center">
          {isMyTurn
            ? 'All passed — you took the top card and 2 from the deck'
            : 'All passed — opponent took the top card and 2 from the deck'}
        </p>
      )}

      {isMyTurn ? (
        <div className="flex flex-col items-center gap-3 w-full">
          <p
            data-testid="your-turn-to-bid"
            className="font-display text-base sm:text-lg font-semibold text-[#e3ba62]"
          >
            {isForced
              ? 'You must choose trump'
              : jackForced
                ? 'You must take'
                : 'Your turn to bid'}
          </p>

          {isRound1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                data-testid="bid-take"
                onClick={bidTake}
                disabled={!isConnected}
                className="btn-brass font-semibold py-2.5 px-7 rounded-xl cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Take
              </button>
              {!jackForced && (
                <button
                  type="button"
                  data-testid="bid-pass"
                  onClick={bidPass}
                  disabled={!isConnected}
                  className="btn-slate font-semibold py-2.5 px-7 rounded-xl cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Pass
                </button>
              )}
            </div>
          )}

          {isRound2 && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap justify-center gap-2 sm:gap-2.5">
                {ALL_SUITS.map((suit) => (
                  <SuitButton
                    key={suit}
                    suit={suit}
                    onClick={() => bidChoose(suit)}
                    disabled={!isConnected || trumpCard?.suit === suit}
                    data-testid={`bid-suit-${suit}`}
                  />
                ))}
              </div>
              <button
                type="button"
                data-testid="bid-pass-round2"
                onClick={bidPass}
                disabled={!isConnected}
                className="btn-slate font-semibold py-2 px-7 rounded-xl cursor-pointer text-sm disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Pass
              </button>
            </div>
          )}

          {isForced && (
            <div className="flex flex-wrap justify-center gap-2 sm:gap-2.5">
              {ALL_SUITS.map((suit) => (
                <SuitButton
                  key={suit}
                  suit={suit}
                  onClick={() => bidChoose(suit)}
                  disabled={!isConnected}
                  data-testid={`bid-suit-${suit}`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <p
          data-testid="waiting-for-opponent"
          className="text-sm text-[#a4bba9] text-center"
        >
          {isForced
            ? 'Waiting for opponent to choose trump...'
            : jackForced
              ? 'Jack turned up — opponent must take'
              : 'Waiting for opponent to bid...'}
        </p>
      )}
    </div>
  );
}

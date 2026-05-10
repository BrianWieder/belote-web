import { useGame } from '../hooks/useGame';
import { Card, SuitButton } from './Card';
import type { Suit } from '../game/types';

const ALL_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export function BiddingUI() {
  const { gameState, bidTake, bidPass, bidChoose, isMyTurn } = useGame();
  if (!gameState) return null;

  const isRound1 = gameState.phase === 'bidding-round1';
  const isRound2 = gameState.phase === 'bidding-round2';
  const isForced = gameState.phase === 'bidding-forced';
  const trumpCard = gameState.trumpCard;

  return (
    <div className="flex flex-col items-center gap-4">
      {trumpCard && (
        <div className="text-center">
          <p className="text-green-300 text-sm mb-2">
            {isRound1 ? 'Take with this trump?' : 'Choose a different suit'}
          </p>
          <div className="flex justify-center">
            <Card card={trumpCard} />
          </div>
        </div>
      )}

      {isMyTurn ? (
        <div className="flex flex-col items-center gap-3">
          <p data-testid="your-turn-to-bid" className="text-yellow-300 font-semibold">
            {isForced ? 'You must choose trump' : 'Your turn to bid'}
          </p>

          {isRound1 && (
            <div className="flex gap-3">
              <button
                data-testid="bid-take"
                onClick={bidTake}
                className="bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Take
              </button>
              <button
                data-testid="bid-pass"
                onClick={bidPass}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Pass
              </button>
            </div>
          )}

          {isRound2 && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-2">
                {ALL_SUITS.map((suit) => (
                  <SuitButton
                    key={suit}
                    suit={suit}
                    onClick={() => bidChoose(suit)}
                    disabled={trumpCard?.suit === suit}
                    data-testid={`bid-suit-${suit}`}
                  />
                ))}
              </div>
              <button
                data-testid="bid-pass-round2"
                onClick={bidPass}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Pass
              </button>
            </div>
          )}

          {isForced && (
            <div className="flex gap-2">
              {ALL_SUITS.map((suit) => (
                <SuitButton
                  key={suit}
                  suit={suit}
                  onClick={() => bidChoose(suit)}
                  data-testid={`bid-suit-${suit}`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <p data-testid="waiting-for-opponent" className="text-green-300">
          {isForced ? 'Waiting for opponent to choose trump...' : 'Waiting for opponent to bid...'}
        </p>
      )}
    </div>
  );
}

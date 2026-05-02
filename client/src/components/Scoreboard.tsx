import { useGame } from '../hooks/useGame';
import type { PlayerID } from '../game/types';

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export function Scoreboard() {
  const { gameState, localPlayer } = useGame();
  if (!gameState) return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;

  return (
    <div data-testid="scoreboard" className="bg-green-800/80 rounded-lg px-4 py-2 text-sm">
      <div className="flex justify-between gap-8">
        <div className="text-center">
          <div className="text-green-400 text-xs">You</div>
          <div className="text-white font-bold text-lg">{gameState.gameScore[localPlayer]}</div>
        </div>
        <div className="text-center">
          <div className="text-green-400 text-xs">Score</div>
          <div className="text-green-500 text-xs mt-1">to 1000</div>
        </div>
        <div className="text-center">
          <div className="text-green-400 text-xs">Opponent</div>
          <div className="text-white font-bold text-lg">{gameState.gameScore[opponent]}</div>
        </div>
      </div>
    </div>
  );
}

export function RoundSummary() {
  const { gameState, localPlayer, nextRound } = useGame();
  if (!gameState || gameState.phase !== 'round-over') return null;

  const lastScore = gameState.roundScores[gameState.roundScores.length - 1];
  if (!lastScore) return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;

  return (
    <div data-testid="round-summary" className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-green-800 rounded-xl p-6 shadow-2xl max-w-sm w-full text-white">
        <h2 data-testid="round-summary-title" className="text-2xl font-bold text-center mb-4">Round Over</h2>

        <div className="space-y-2 mb-4 text-sm">
          <div className="flex justify-between">
            <span>Trump:</span>
            <span className={lastScore.trumpSuit === 'hearts' || lastScore.trumpSuit === 'diamonds' ? 'text-red-400' : ''}>
              {SUIT_SYMBOLS[lastScore.trumpSuit]} ({lastScore.taker === localPlayer ? 'You' : 'Opponent'} took)
            </span>
          </div>

          <div className="border-t border-green-700 pt-2 flex justify-between">
            <span>Trick points:</span>
            <span>{lastScore.trickPoints[localPlayer]} - {lastScore.trickPoints[opponent]}</span>
          </div>

          {(lastScore.lastTrickBonus[0] > 0 || lastScore.lastTrickBonus[1] > 0) && (
            <div className="flex justify-between">
              <span>Last trick:</span>
              <span>+{lastScore.lastTrickBonus[localPlayer]} - +{lastScore.lastTrickBonus[opponent]}</span>
            </div>
          )}

          {(lastScore.beloteBonus[0] > 0 || lastScore.beloteBonus[1] > 0) && (
            <div className="flex justify-between">
              <span>Belote:</span>
              <span>+{lastScore.beloteBonus[localPlayer]} - +{lastScore.beloteBonus[opponent]}</span>
            </div>
          )}

          {lastScore.dedans && (
            <div className="text-red-400 font-semibold text-center">
              Dedans! {lastScore.taker === localPlayer ? 'You' : 'Opponent'} failed to make the contract
            </div>
          )}

          <div className="border-t border-green-700 pt-2 flex justify-between font-bold text-lg">
            <span>Round total:</span>
            <span>{lastScore.finalPoints[localPlayer]} - {lastScore.finalPoints[opponent]}</span>
          </div>

          <div className="flex justify-between text-green-300">
            <span>Game score:</span>
            <span>{gameState.gameScore[localPlayer]} - {gameState.gameScore[opponent]}</span>
          </div>
        </div>

        <button
          data-testid="next-round"
          onClick={nextRound}
          className="w-full bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold py-3 rounded-lg transition-colors"
        >
          Next Round
        </button>
      </div>
    </div>
  );
}

export function GameOver() {
  const { gameState, localPlayer } = useGame();
  if (!gameState || gameState.phase !== 'game-over') return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const won = gameState.gameScore[localPlayer] >= gameState.gameScore[opponent];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-green-800 rounded-xl p-8 shadow-2xl max-w-sm w-full text-white text-center">
        <h2 className="text-3xl font-bold mb-4">{won ? 'You Win!' : 'You Lose'}</h2>
        <div className="text-4xl font-bold mb-4">
          {gameState.gameScore[localPlayer]} - {gameState.gameScore[opponent]}
        </div>
        <button
          onClick={() => window.location.reload()}
          className="bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold py-3 px-8 rounded-lg transition-colors"
        >
          Play Again
        </button>
      </div>
    </div>
  );
}

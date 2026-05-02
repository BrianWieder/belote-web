import { useGame } from '../hooks/useGame';
import { BiddingUI } from './BiddingUI';
import { PlayArea } from './PlayArea';
import { Hand } from './Hand';
import { OpponentHand } from './OpponentHand';
import { Tableau } from './Tableau';
import { Scoreboard, RoundSummary, GameOver } from './Scoreboard';
import type { PlayerID } from '../game/types';

export function GameBoard() {
  const { gameState, localPlayer } = useGame();
  if (!gameState) return null;

  const isBidding = gameState.phase === 'bidding-round1' || gameState.phase === 'bidding-round2';
  const isPlaying = gameState.phase === 'playing';
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;

  return (
    <div data-testid="game-board" className="flex flex-col min-h-screen bg-green-900 text-white">
      {/* Top bar - scoreboard */}
      <div className="flex justify-center p-3">
        <Scoreboard />
      </div>

      {/* Opponent hand */}
      <div className="px-4 py-2">
        <OpponentHand />
      </div>

      {/* Opponent tableau */}
      {isPlaying && (
        <div className="px-4 py-1">
          <Tableau player={opponent} />
        </div>
      )}

      {/* Center area */}
      <div className="flex-1 flex items-center justify-center px-4">
        {isBidding && <BiddingUI />}
        {isPlaying && <PlayArea />}
      </div>

      {/* Player tableau */}
      {isPlaying && (
        <div className="px-4 py-1">
          <Tableau player={localPlayer} />
        </div>
      )}

      {/* Player hand */}
      <div className="px-4 py-4 pb-6">
        <Hand />
      </div>

      {/* Modals */}
      <RoundSummary />
      <GameOver />
    </div>
  );
}

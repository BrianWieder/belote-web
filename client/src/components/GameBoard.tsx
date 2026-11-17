import { useGame } from '../hooks/useGame';
import { useGameStore } from '../store/gameStore';
import { destroyPeer } from '../networking/peer';
import { disconnectSignaling } from '../networking/signaling';
import { BiddingUI } from './BiddingUI';
import { PlayArea } from './PlayArea';
import { Hand } from './Hand';
import { OpponentHand } from './OpponentHand';
import { Tableau } from './Tableau';
import { Scoreboard, RoundSummary, GameOver } from './Scoreboard';
import type { PlayerID } from '../game/types';

export function GameBoard() {
  const { gameState, localPlayer } = useGame();
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const resetConnection = useGameStore((s) => s.resetConnection);

  if (!gameState) return null;

  const isBidding =
    gameState.phase === 'bidding-round1' ||
    gameState.phase === 'bidding-round2' ||
    gameState.phase === 'bidding-forced';
  const isPlaying = gameState.phase === 'playing';
  const showTableau = isPlaying || gameState.phase === 'bidding-forced';
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;

  const handleReturnToLobby = () => {
    destroyPeer();
    disconnectSignaling();
    resetConnection();
  };

  return (
    <main
      data-testid="game-board"
      className="tapis-surface flex flex-col justify-between h-full text-[#efe9dc] select-none overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 sm:px-4 pt-2.5 ultra-short:pt-1.5 pb-[max(0.85rem,env(safe-area-inset-bottom))] ultra-short:pb-[max(0.4rem,env(safe-area-inset-bottom))]"
    >
      {/* Top section: Scoreboard + Opponent zone */}
      <div className="flex flex-col items-center gap-2 ultra-short:gap-1">
        <Scoreboard />

        {connectionStatus === 'disconnected' && (
          <div
            role="alert"
            className="relative z-[60] w-full max-w-lg rounded-xl bg-[#5c1619]/90 border border-[#e45a5e]/40 px-4 py-2 text-xs sm:text-sm text-[#f7b4b6] flex items-center justify-between gap-3"
          >
            <span>Connection to your opponent was lost.</span>
            <button
              type="button"
              onClick={handleReturnToLobby}
              className="btn-slate rounded-lg px-3 py-1 text-xs font-semibold text-[#efe9dc] shrink-0 cursor-pointer"
            >
              Return to lobby
            </button>
          </div>
        )}

        <OpponentHand />

        {showTableau && (
          <div className="pt-0.5">
            <Tableau player={opponent} />
          </div>
        )}
      </div>

      {/* Center table: Bidding or Trick mat */}
      <div className="my-auto py-2 ultra-short:py-0.5 flex items-center justify-center">
        {isBidding && <BiddingUI />}
        {isPlaying && <PlayArea />}
      </div>

      {/* Bottom section: Local player tableau + hand */}
      <div className="flex flex-col items-center gap-2.5 tall-sm:gap-3 ultra-short:gap-1">
        {showTableau && <Tableau player={localPlayer} />}
        <Hand />
      </div>

      {/* End-of-round & end-of-game dialogs */}
      <RoundSummary />
      <GameOver />
    </main>
  );
}

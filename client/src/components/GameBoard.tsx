import { useCallback, useEffect } from 'react';
import { useGame } from '../hooks/useGame';
import { useGameFeedback } from '../hooks/useGameFeedback';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useGameStore } from '../store/gameStore';
import { destroyPeer } from '../networking/peer';
import { disconnectSignaling } from '../networking/signaling';
import { BiddingUI } from './BiddingUI';
import { PlayArea } from './PlayArea';
import { Hand } from './Hand';
import { OpponentHand } from './OpponentHand';
import { Tableau } from './Tableau';
import { Scoreboard, RoundSummary, GameOver } from './Scoreboard';
import { TrumpAnnouncement } from './TrumpAnnouncement';
import type { PlayerID } from '../game/types';

export function GameBoard() {
  useGameFeedback();
  const { gameState, localPlayer, isConnected, isMyTurn, bidTake, bidPass } = useGame();
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const hostGameSaved = useGameStore((s) => s.hostGameSaved);
  const resetConnection = useGameStore((s) => s.resetConnection);
  const twoTapPlay = useGameStore((s) => s.twoTapPlay);
  const selectedCardKey = useGameStore((s) => s.selectedCardKey);
  const setSelectedCardKey = useGameStore((s) => s.setSelectedCardKey);

  const isModalOpen =
    gameState?.phase === 'round-over' || gameState?.phase === 'game-over';

  const clearSelection = useCallback(() => {
    setSelectedCardKey(null);
  }, [setSelectedCardKey]);

  useKeyboardShortcuts({
    phase: gameState?.phase ?? null,
    trumpCardRank: gameState?.trumpCard?.rank ?? null,
    isMyTurn: isMyTurn && isConnected,
    isModalOpen,
    hasSelectedCard: selectedCardKey !== null,
    onBidTake: bidTake,
    onBidPass: bidPass,
    onClearSelection: clearSelection,
  });

  // Tapping anywhere outside a playable card clears any pending 2-tap selection.
  useEffect(() => {
    if (!selectedCardKey) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('button[data-playable]')) {
        return;
      }
      setSelectedCardKey(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [selectedCardKey, setSelectedCardKey]);

  if (!gameState) return null;

  const isBidding =
    gameState.phase === 'bidding-round1' ||
    gameState.phase === 'bidding-round2' ||
    gameState.phase === 'bidding-forced';
  const isPlaying = gameState.phase === 'playing';
  const showTableau = isPlaying;
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const isDisconnected = connectionStatus === 'disconnected';
  const showTwoTapHint = isPlaying && isMyTurn && isConnected && twoTapPlay && selectedCardKey !== null;

  const handleReturnToLobby = () => {
    destroyPeer();
    disconnectSignaling();
    resetConnection();
  };

  return (
    <main
      data-testid="game-board"
      className="tapis-surface flex flex-col justify-between h-full text-[#efe9dc] select-none overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 sm:px-4 pt-[max(0.625rem,env(safe-area-inset-top))] ultra-short:pt-[max(0.375rem,env(safe-area-inset-top))] pb-[max(0.85rem,env(safe-area-inset-bottom))] ultra-short:pb-[max(0.4rem,env(safe-area-inset-bottom))]"
    >
      {/* Top section: Scoreboard + Opponent zone */}
      <div className="flex flex-col items-center gap-2 ultra-short:gap-1">
        <Scoreboard />

        {isDisconnected && !isModalOpen && (
          <div
            role="alert"
            className="w-full max-w-lg rounded-xl bg-[#5c1619]/90 border border-[#e45a5e]/40 px-4 py-2 text-xs sm:text-sm text-[#f7b4b6] flex items-center justify-between gap-3"
          >
            <span>
              {hostGameSaved
                ? 'Connection lost — your match is saved. Return to the lobby to resume.'
                : 'Connection to your opponent was lost.'}
            </span>
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
      <div className="relative flex flex-col items-center gap-2.5 tall-sm:gap-3 ultra-short:gap-1">
        {showTwoTapHint && (
          <div
            data-testid="two-tap-hint"
            className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap rounded-full bg-[#11261c]/95 border border-[#d4a84b]/65 px-3 py-0.5 text-[11px] font-medium text-[#e3ba62] shadow-[0_6px_16px_rgba(4,12,8,0.55)]"
          >
            Tap again to play
          </div>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {showTwoTapHint ? 'Card selected. Tap again to play.' : ''}
        </span>
        {showTableau && <Tableau player={localPlayer} />}
        <Hand />
      </div>

      {/* Trump suit announcement & end-of-round / end-of-game dialogs */}
      <TrumpAnnouncement />
      <RoundSummary
        disconnected={isDisconnected}
        matchSaved={hostGameSaved}
        onReturnToLobby={handleReturnToLobby}
      />
      <GameOver disconnected={isDisconnected} onReturnToLobby={handleReturnToLobby} />
    </main>
  );
}

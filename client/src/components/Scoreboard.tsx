import { useSyncExternalStore } from 'react';
import { useGame } from '../hooks/useGame';
import { isMuted, subscribeMuted, toggleMuted } from '../audio/sounds';
import { SuitIcon } from './Card';
import { SUIT_NAMES, isRedSuit } from './suits';
import type { PlayerID } from '../game/types';

const TARGET_SCORE = 1000;

export function Scoreboard() {
  const { gameState, localPlayer } = useGame();
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  if (!gameState) return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const myScore = gameState.gameScore[localPlayer];
  const oppScore = gameState.gameScore[opponent];
  const myPct = Math.min(100, Math.round((myScore / TARGET_SCORE) * 100));
  const oppPct = Math.min(100, Math.round((oppScore / TARGET_SCORE) * 100));
  const roundNum = gameState.roundScores.length + 1;

  return (
    <header
      data-testid="scoreboard"
      className="ardoise-bar w-full max-w-lg rounded-xl px-3.5 py-2 tall-sm:px-5 tall-sm:py-2.5 ultra-short:py-1.5"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="grid grid-cols-3 items-center gap-2 sm:gap-3 flex-1 min-w-0">
          {/* Local player score */}
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-1.5 text-xs text-[#a4bba9]">
              <span>You</span>
              {gameState.dealer === localPlayer && (
                <span
                  title="Dealer for this round"
                  className="inline-flex items-center rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/45 px-1.5 py-[1px] text-[10px] font-medium text-[#e3ba62]"
                >
                  Dealer
                </span>
              )}
            </div>
            <div className="font-display text-lg sm:text-xl font-semibold text-[#efe9dc] tabular-nums leading-tight">
              {myScore}
            </div>
            <div className="w-full max-w-24 h-1 rounded-full bg-[#efe9dc]/10 mt-1 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#d4a84b] transition-all duration-300"
                style={{ width: `${myPct}%` }}
              />
            </div>
          </div>

          {/* Center round & target */}
          <div className="text-center">
            <div className="font-display text-xs sm:text-sm font-medium text-[#efe9dc]">
              Round {roundNum}
            </div>
            <div className="text-[11px] text-[#73907c] tabular-nums">
              First to 1,000
            </div>
          </div>

          {/* Opponent score */}
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-xs text-[#a4bba9]">
              {gameState.dealer === opponent && (
                <span
                  title="Dealer for this round"
                  className="inline-flex items-center rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/45 px-1.5 py-[1px] text-[10px] font-medium text-[#e3ba62]"
                >
                  Dealer
                </span>
              )}
              <span>Opponent</span>
            </div>
            <div className="font-display text-lg sm:text-xl font-semibold text-[#efe9dc] tabular-nums leading-tight">
              {oppScore}
            </div>
            <div className="w-full max-w-24 h-1 rounded-full bg-[#efe9dc]/10 mt-1 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#a4bba9] transition-all duration-300 ml-auto"
                style={{ width: `${oppPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Sound mute/unmute toggle */}
        <div className="pl-2 border-l border-[#efe9dc]/12 shrink-0">
          <button
            type="button"
            data-testid="sound-toggle"
            aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
            aria-pressed={muted}
            title={muted ? 'Unmute sound effects' : 'Mute sound effects'}
            onClick={() => toggleMuted()}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              muted
                ? 'text-[#73907c] bg-[#efe9dc]/5 border border-[#efe9dc]/10 hover:text-[#a4bba9]'
                : 'text-[#a4bba9] hover:text-[#efe9dc] hover:bg-[#efe9dc]/10 border border-transparent'
            }`}
          >
            {muted ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="w-4 h-4"
              >
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="22" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="22" y2="15" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="w-4 h-4"
              >
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

interface DialogDisconnectProps {
  disconnected?: boolean;
  matchSaved?: boolean;
  onReturnToLobby?: () => void;
}

export function RoundSummary({ disconnected, matchSaved, onReturnToLobby }: DialogDisconnectProps) {
  const { gameState, localPlayer, nextRound } = useGame();
  if (!gameState || gameState.phase !== 'round-over') return null;

  const lastScore = gameState.roundScores[gameState.roundScores.length - 1];
  if (!lastScore) return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const red = isRedSuit(lastScore.trumpSuit);

  return (
    <div
      data-testid="round-summary"
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-summary-heading"
      className="fixed inset-0 bg-[#06110c]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div className="ardoise-panel rounded-2xl p-6 sm:p-7 max-w-sm w-full text-[#efe9dc]">
        <h2
          id="round-summary-heading"
          data-testid="round-summary-title"
          className="font-display text-2xl sm:text-3xl font-semibold text-center"
        >
          Round Over
        </h2>

        {/* Contract badge */}
        <div className="mt-2 mb-5 flex items-center justify-center gap-1.5 text-xs sm:text-sm text-[#a4bba9]">
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              red ? 'text-[#e45a5e]' : 'text-[#efe9dc]'
            }`}
          >
            <SuitIcon suit={lastScore.trumpSuit} className="w-4 h-4" />
            {SUIT_NAMES[lastScore.trumpSuit]}
          </span>
          <span>
            trump, taken by {lastScore.taker === localPlayer ? 'you' : 'opponent'}
          </span>
        </div>

        {lastScore.dedans && (
          <div className="mb-4 rounded-xl bg-[#5c1619]/60 border border-[#e45a5e]/35 px-3.5 py-2.5 text-xs sm:text-sm text-[#f7b4b6] text-center">
            <strong>Dedans:</strong>{' '}
            {lastScore.taker === localPlayer ? 'You' : 'Opponent'} fell short of the contract — all 162 points go to the defender.
          </div>
        )}

        {/* Two-column score ledger */}
        <div className="tapis-ring rounded-xl p-4 mb-5 text-sm tabular-nums">
          <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-2 pb-2 mb-2 border-b border-[#efe9dc]/12 text-xs text-[#a4bba9]">
            <span>Breakdown</span>
            <span className="text-right font-medium text-[#efe9dc]">You</span>
            <span className="text-right">Opp</span>
          </div>

          <div className="space-y-1.5 text-xs sm:text-sm">
            <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-2">
              <span className="text-[#a4bba9]">Trick points</span>
              <span className="text-right">{lastScore.trickPoints[localPlayer]}</span>
              <span className="text-right text-[#a4bba9]">{lastScore.trickPoints[opponent]}</span>
            </div>

            {(lastScore.lastTrickBonus[0] > 0 || lastScore.lastTrickBonus[1] > 0) && (
              <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-2">
                <span className="text-[#a4bba9]">Last trick</span>
                <span className="text-right">
                  {lastScore.lastTrickBonus[localPlayer] > 0
                    ? `+${lastScore.lastTrickBonus[localPlayer]}`
                    : '–'}
                </span>
                <span className="text-right text-[#a4bba9]">
                  {lastScore.lastTrickBonus[opponent] > 0
                    ? `+${lastScore.lastTrickBonus[opponent]}`
                    : '–'}
                </span>
              </div>
            )}

            {(lastScore.beloteBonus[0] > 0 || lastScore.beloteBonus[1] > 0) && (
              <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-2">
                <span className="text-[#a4bba9]">Belote &amp; Rebelote</span>
                <span className="text-right">
                  {lastScore.beloteBonus[localPlayer] > 0
                    ? `+${lastScore.beloteBonus[localPlayer]}`
                    : '–'}
                </span>
                <span className="text-right text-[#a4bba9]">
                  {lastScore.beloteBonus[opponent] > 0
                    ? `+${lastScore.beloteBonus[opponent]}`
                    : '–'}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-2 pt-2.5 mt-2.5 border-t border-[#efe9dc]/12 font-display text-base font-semibold">
            <span>Round total</span>
            <span className="text-right text-[#e3ba62]">+{lastScore.finalPoints[localPlayer]}</span>
            <span className="text-right">+{lastScore.finalPoints[opponent]}</span>
          </div>

          <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-2 pt-2 mt-2 border-t border-[#efe9dc]/10 text-xs text-[#a4bba9]">
            <span>Match score</span>
            <span className="text-right font-semibold text-[#efe9dc]">
              {gameState.gameScore[localPlayer]}
            </span>
            <span className="text-right">{gameState.gameScore[opponent]}</span>
          </div>
        </div>

        {disconnected && onReturnToLobby ? (
          <div className="space-y-2.5">
            <p
              role="alert"
              className="rounded-xl bg-[#5c1619]/75 border border-[#e45a5e]/40 px-3.5 py-2 text-xs text-[#f7b4b6]"
            >
              {matchSaved
                ? 'Connection lost — your match is saved. Return to the lobby to resume.'
                : 'Connection to your opponent was lost.'}
            </p>
            <button
              type="button"
              onClick={onReturnToLobby}
              className="btn-slate w-full font-semibold py-3 rounded-xl cursor-pointer"
            >
              Return to lobby
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="next-round"
            onClick={nextRound}
            className="btn-brass w-full font-semibold py-3 rounded-xl cursor-pointer"
          >
            Deal next round
          </button>
        )}
      </div>
    </div>
  );
}

export function GameOver({ disconnected, onReturnToLobby }: DialogDisconnectProps) {
  const { gameState, localPlayer } = useGame();
  if (!gameState || gameState.phase !== 'game-over') return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const myScore = gameState.gameScore[localPlayer];
  const oppScore = gameState.gameScore[opponent];
  const isDraw = myScore === oppScore;
  const won = myScore > oppScore;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-heading"
      className="fixed inset-0 bg-[#06110c]/80 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div className="ardoise-panel rounded-2xl p-7 sm:p-8 max-w-sm w-full text-[#efe9dc] text-center">
        <h2
          id="game-over-heading"
          className="font-display text-3xl sm:text-4xl font-semibold mb-2"
        >
          {isDraw ? "It's a Draw!" : won ? 'You Win!' : 'Opponent Wins'}
        </h2>
        <p className="text-sm text-[#a4bba9] mb-5">
          {gameState.roundScores.length} {gameState.roundScores.length === 1 ? 'round' : 'rounds'} played
        </p>

        <div className="tapis-ring rounded-xl py-4 px-5 mb-6 flex items-center justify-around tabular-nums">
          <div>
            <div className="text-xs text-[#a4bba9] mb-0.5">You</div>
            <div className="font-display text-3xl font-bold text-[#e3ba62]">
              {gameState.gameScore[localPlayer]}
            </div>
          </div>
          <div className="h-8 w-px bg-[#efe9dc]/15" />
          <div>
            <div className="text-xs text-[#a4bba9] mb-0.5">Opponent</div>
            <div className="font-display text-3xl font-bold text-[#efe9dc]">
              {gameState.gameScore[opponent]}
            </div>
          </div>
        </div>

        {disconnected && onReturnToLobby ? (
          <div className="space-y-2.5">
            <p
              role="alert"
              className="rounded-xl bg-[#5c1619]/75 border border-[#e45a5e]/40 px-3.5 py-2 text-xs text-[#f7b4b6]"
            >
              Connection to your opponent was lost.
            </p>
            <button
              type="button"
              onClick={onReturnToLobby}
              className="btn-slate w-full font-semibold py-3.5 px-8 rounded-xl cursor-pointer"
            >
              Return to lobby
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-brass w-full font-semibold py-3.5 px-8 rounded-xl cursor-pointer"
          >
            Start a new match
          </button>
        )}
      </div>
    </div>
  );
}

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useGame } from '../hooks/useGame';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useGameStore } from '../store/gameStore';
import { isMuted, subscribeMuted, toggleMuted } from '../audio/sounds';
import { SuitIcon } from './Card';
import { RulesModal } from './RulesModal';
import { ScoreLedgerModal } from './ScoreLedgerModal';
import { SUIT_NAMES, isRedSuit } from './suits';
import { DEFAULT_MATCH_OPTIONS, type PlayerID } from '../game/types';

interface ScoreboardProps {
  onLeave?: () => void;
}

export function Scoreboard({ onLeave }: ScoreboardProps = {}) {
  const { gameState, localPlayer } = useGame();
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const gameMode = useGameStore((s) => s.gameMode);
  const botDifficulty = useGameStore((s) => s.botDifficulty);
  const playerNames = useGameStore((s) => s.playerNames);
  const twoTapPlay = useGameStore((s) => s.twoTapPlay);
  const toggleTwoTapPlay = useGameStore((s) => s.toggleTwoTapPlay);
  const [activeModal, setActiveModal] = useState<'rules' | 'ledger' | null>(null);
  const handleCloseModal = useCallback(() => setActiveModal(null), []);

  if (!gameState) return null;

  const isBot = gameMode === 'bot';
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const options = gameState.options ?? DEFAULT_MATCH_OPTIONS;
  const targetScore = options.targetScore;
  const myName = playerNames[localPlayer] ?? 'You';
  const opponentLabel = isBot
    ? `Bot (${botDifficulty === 'smart' ? 'Smart' : 'Casual'})`
    : (playerNames[opponent] ?? 'Opponent');
  const oppLedgerLabel = isBot ? 'Bot' : (playerNames[opponent] ?? 'Opp');
  const myScore = gameState.gameScore[localPlayer];
  const oppScore = gameState.gameScore[opponent];
  const myPct = Math.min(100, Math.round((myScore / targetScore) * 100));
  const oppPct = Math.min(100, Math.round((oppScore / targetScore) * 100));
  const completedRounds = gameState.roundScores.length;
  const roundNum = completedRounds + 1;

  return (
    <>
      <header
        data-testid="scoreboard"
        className="ardoise-bar flex-1 min-w-0 rounded-xl px-3.5 py-2 tall-sm:px-5 tall-sm:py-2.5 ultra-short:py-1.5"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3 flex-1 min-w-0">
            {/* Local player score */}
            <div className="flex flex-col items-start min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-[#a4bba9] max-w-full">
                <span className="truncate">{myName}</span>
                {gameState.dealer === localPlayer && (
                  <span
                    title="Dealer for this round"
                    className="inline-flex items-center rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/45 px-1.5 py-[1px] text-[10px] font-medium text-[#e3ba62] shrink-0"
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

            {/* Center round, target & utility controls */}
            <div className="flex flex-col items-center text-center">
              <div className="font-display text-xs sm:text-sm font-medium text-[#efe9dc] leading-tight">
                Round {roundNum}
              </div>
              <div className="text-[11px] text-[#73907c] tabular-nums leading-tight">
                First to {targetScore.toLocaleString()}
              </div>
              <div className="mt-1 ultra-short:mt-0.5 flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  data-testid="two-tap-toggle"
                  aria-pressed={twoTapPlay}
                  aria-label="2-tap: Require two taps to play a card"
                  title="Require two taps to play a card"
                  onClick={toggleTwoTapPlay}
                  className={`inline-flex items-center gap-1 h-6 rounded-full border px-2 text-[10px] font-medium transition-colors cursor-pointer ${
                    twoTapPlay
                      ? 'bg-[#d4a84b]/22 border-[#d4a84b]/65 text-[#e3ba62]'
                      : 'bg-[#efe9dc]/6 border-[#efe9dc]/18 text-[#a4bba9] hover:border-[#efe9dc]/35 hover:text-[#efe9dc]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full ${
                      twoTapPlay ? 'bg-[#e3ba62]' : 'bg-[#73907c]/65'
                    }`}
                  />
                  2-tap
                </button>
                <button
                  type="button"
                  data-testid="open-score-ledger"
                  aria-label="View round score history"
                  title="Score ledger"
                  onClick={() => setActiveModal('ledger')}
                  className="btn-slate inline-flex items-center justify-center gap-1 h-6 px-2 rounded-full text-[11px] font-medium text-[#a4bba9] hover:text-[#efe9dc] cursor-pointer tabular-nums"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="w-3 h-3 text-[#d4a84b]"
                  >
                    <path d="M3 4h10M3 8h10M3 12h6" />
                  </svg>
                  {completedRounds > 0 && (
                    <span className="text-[#e3ba62]">{completedRounds}</span>
                  )}
                </button>
                <button
                  type="button"
                  data-testid="open-rules"
                  aria-label="Rules and card values"
                  title="Rules & card values"
                  onClick={() => setActiveModal('rules')}
                  className="btn-slate inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-display font-semibold text-[#e3ba62] cursor-pointer"
                >
                  ?
                </button>
                {isBot && onLeave && (
                  <button
                    type="button"
                    data-testid="leave-bot-game"
                    onClick={onLeave}
                    className="btn-slate inline-flex items-center justify-center h-6 px-2 rounded-full text-[10px] font-medium text-[#a4bba9] hover:text-[#efe9dc] cursor-pointer transition-colors"
                  >
                    Leave
                  </button>
                )}
              </div>
            </div>

            {/* Opponent score */}
            <div className="flex flex-col items-end min-w-0">
              <div className="flex items-center justify-end gap-1.5 text-xs text-[#a4bba9] max-w-full">
                {gameState.dealer === opponent && (
                  <span
                    title="Dealer for this round"
                    className="inline-flex items-center rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/45 px-1.5 py-[1px] text-[10px] font-medium text-[#e3ba62] shrink-0"
                  >
                    Dealer
                  </span>
                )}
                <span className="truncate">{opponentLabel}</span>
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

      <RulesModal open={activeModal === 'rules'} onClose={handleCloseModal} options={options} />
      <ScoreLedgerModal
        open={activeModal === 'ledger'}
        onClose={handleCloseModal}
        roundScores={gameState.roundScores}
        localPlayer={localPlayer}
        targetScore={targetScore}
        myLabel={myName}
        oppLabel={oppLedgerLabel}
      />
    </>
  );
}

interface DialogDisconnectProps {
  reconnecting?: boolean;
  disconnected?: boolean;
  matchSaved?: boolean;
  onReturnToLobby?: () => void;
}

export function RoundSummary({ reconnecting, disconnected, matchSaved, onReturnToLobby }: DialogDisconnectProps) {
  const { gameState, localPlayer, roundReady, nextRound } = useGame();
  const gameMode = useGameStore((s) => s.gameMode);
  const playerNames = useGameStore((s) => s.playerNames);
  const dialogRef = useRef<HTMLDivElement>(null);

  const lastScore =
    gameState && gameState.phase === 'round-over'
      ? gameState.roundScores[gameState.roundScores.length - 1] ?? null
      : null;
  const isOpen = Boolean(lastScore);

  useFocusTrap(dialogRef, isOpen);

  if (!gameState || !lastScore) return null;

  const isBot = gameMode === 'bot';
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const red = isRedSuit(lastScore.trumpSuit);
  const localReady = roundReady[localPlayer];
  const opponentReady = roundReady[opponent];
  const myHeader = playerNames[localPlayer] ?? 'You';
  const oppHeader = isBot ? 'Bot' : (playerNames[opponent] ?? 'Opp');
  const takerLowerName =
    lastScore.taker === localPlayer
      ? (playerNames[localPlayer] ?? 'you')
      : isBot
        ? 'Bot'
        : (playerNames[opponent] ?? 'opponent');
  const takerCapName =
    lastScore.taker === localPlayer
      ? (playerNames[localPlayer] ?? 'You')
      : isBot
        ? 'Bot'
        : (playerNames[opponent] ?? 'Opponent');
  const capotWinner: PlayerID | null = lastScore.capot
    ? lastScore.finalPoints[localPlayer] > lastScore.finalPoints[opponent]
      ? localPlayer
      : opponent
    : null;
  const capotWinnerName =
    capotWinner === localPlayer
      ? (playerNames[localPlayer] ?? 'You')
      : isBot
        ? 'Bot'
        : (playerNames[opponent] ?? 'Opponent');

  return (
    <div
      data-testid="round-summary"
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-summary-heading"
      className="fixed inset-0 bg-[#06110c]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="ardoise-panel rounded-2xl p-6 sm:p-7 max-w-sm w-full text-[#efe9dc] focus:outline-none"
      >
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
            trump, taken by {takerLowerName}
          </span>
        </div>

        {lastScore.capot && capotWinner !== null && (
          <div
            data-testid="capot-badge"
            className="mb-4 rounded-xl bg-[#d4a84b]/15 border border-[#d4a84b]/55 px-3.5 py-2.5 text-xs sm:text-sm text-[#f4dd9d] text-center"
          >
            <strong className="font-display text-[#e3ba62]">Capot!</strong>{' '}
            {capotWinnerName} won all 16 tricks for {lastScore.finalPoints[capotWinner]} points
            {lastScore.dedans ? ' (dedans).' : '.'}
          </div>
        )}

        {lastScore.dedans && !lastScore.capot && (
          <div className="mb-4 rounded-xl bg-[#5c1619]/60 border border-[#e45a5e]/35 px-3.5 py-2.5 text-xs sm:text-sm text-[#f7b4b6] text-center">
            <strong>Dedans:</strong>{' '}
            {takerCapName} fell short of the contract — all 162 points go to the defender.
          </div>
        )}

        {/* Two-column score ledger */}
        <div className="tapis-ring rounded-xl p-4 mb-5 text-sm tabular-nums">
          <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2 pb-2 mb-2 border-b border-[#efe9dc]/12 text-xs text-[#a4bba9]">
            <span>Breakdown</span>
            <span className="text-right font-medium text-[#efe9dc] truncate">{myHeader}</span>
            <span className="text-right truncate">{oppHeader}</span>
          </div>

          <div className="space-y-1.5 text-xs sm:text-sm">
            <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2">
              <span className="text-[#a4bba9]">Trick points</span>
              <span className="text-right">{lastScore.trickPoints[localPlayer]}</span>
              <span className="text-right text-[#a4bba9]">{lastScore.trickPoints[opponent]}</span>
            </div>

            {lastScore.capot && capotWinner !== null && (
              <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2">
                <span className="text-[#e3ba62]">Capot bonus</span>
                <span className="text-right text-[#e3ba62]">
                  {capotWinner === localPlayer ? '+100' : '–'}
                </span>
                <span className="text-right text-[#a4bba9]">
                  {capotWinner === opponent ? '+100' : '–'}
                </span>
              </div>
            )}

            {(lastScore.lastTrickBonus[0] > 0 || lastScore.lastTrickBonus[1] > 0) && (
              <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2">
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
              <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2">
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

          <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2 pt-2.5 mt-2.5 border-t border-[#efe9dc]/12 font-display text-base font-semibold">
            <span>Round total</span>
            <span className="text-right text-[#e3ba62]">+{lastScore.finalPoints[localPlayer]}</span>
            <span className="text-right">+{lastScore.finalPoints[opponent]}</span>
          </div>

          <div className="grid grid-cols-[1fr_minmax(3.5rem,5rem)_minmax(3.5rem,5rem)] gap-2 pt-2 mt-2 border-t border-[#efe9dc]/10 text-xs text-[#a4bba9]">
            <span>Match score</span>
            <span className="text-right font-semibold text-[#efe9dc]">
              {gameState.gameScore[localPlayer]}
            </span>
            <span className="text-right">{gameState.gameScore[opponent]}</span>
          </div>
        </div>

        {isBot ? (
          <button
            type="button"
            data-testid="next-round"
            onClick={nextRound}
            className="btn-brass w-full font-semibold py-3 rounded-xl cursor-pointer inline-flex items-center justify-center gap-2"
          >
            Deal next round
          </button>
        ) : reconnecting && onReturnToLobby ? (
          <div className="space-y-2.5">
            <p
              role="status"
              aria-live="polite"
              className="rounded-xl bg-[#4b3812]/80 border border-[#d4a84b]/45 px-3.5 py-2 text-xs text-[#f4d78b]"
            >
              Reconnecting to opponent…
            </p>
            <button
              type="button"
              onClick={onReturnToLobby}
              className="btn-slate w-full font-semibold py-3 rounded-xl cursor-pointer"
            >
              Return to lobby
            </button>
          </div>
        ) : disconnected && onReturnToLobby ? (
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
          <div className="space-y-2.5">
            {opponentReady && !localReady && (
              <div
                data-testid="opponent-round-ready"
                role="status"
                className="flex items-center justify-center gap-2 rounded-xl bg-[#d4a84b]/12 border border-[#d4a84b]/35 px-3 py-1.5 text-xs font-medium text-[#e3ba62]"
              >
                <span className="h-2 w-2 rounded-full bg-[#e3ba62]" aria-hidden="true" />
                Opponent is ready
              </div>
            )}
            <button
              type="button"
              data-testid="next-round"
              disabled={localReady}
              onClick={nextRound}
              className="btn-brass w-full font-semibold py-3 rounded-xl cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {localReady && (
                <span
                  className="h-2 w-2 rounded-full bg-current animate-pulse"
                  aria-hidden="true"
                />
              )}
              {localReady
                ? 'Waiting for opponent…'
                : opponentReady
                  ? 'Deal next round'
                  : 'Ready for next round'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function GameOver({ reconnecting, disconnected, onReturnToLobby }: DialogDisconnectProps) {
  const { gameState, localPlayer, rematchReady, requestRematch } = useGame();
  const gameMode = useGameStore((s) => s.gameMode);
  const botDifficulty = useGameStore((s) => s.botDifficulty);
  const playerNames = useGameStore((s) => s.playerNames);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = Boolean(gameState && gameState.phase === 'game-over');

  useFocusTrap(dialogRef, isOpen);

  if (!gameState || !isOpen) return null;

  const isBot = gameMode === 'bot';
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const myName = playerNames[localPlayer] ?? 'You';
  const opponentLabel = isBot
    ? `Bot (${botDifficulty === 'smart' ? 'Smart' : 'Casual'})`
    : (playerNames[opponent] ?? 'Opponent');
  const oppHeadingName = isBot ? 'Bot' : (playerNames[opponent] ?? 'Opponent');
  const myScore = gameState.gameScore[localPlayer];
  const oppScore = gameState.gameScore[opponent];
  const isDraw = myScore === oppScore;
  const won = myScore > oppScore;
  const localReady = rematchReady[localPlayer];
  const opponentReady = rematchReady[opponent];

  return (
    <div
      data-testid="game-over"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-heading"
      className="fixed inset-0 bg-[#06110c]/80 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="ardoise-panel rounded-2xl p-7 sm:p-8 max-w-sm w-full text-[#efe9dc] text-center focus:outline-none"
      >
        <h2
          id="game-over-heading"
          className="font-display text-3xl sm:text-4xl font-semibold mb-2"
        >
          {isDraw ? "It's a Draw!" : won ? 'You Win!' : `${oppHeadingName} Wins`}
        </h2>
        <p className="text-sm text-[#a4bba9] mb-5">
          {gameState.roundScores.length} {gameState.roundScores.length === 1 ? 'round' : 'rounds'} played
        </p>

        <div className="tapis-ring rounded-xl py-4 px-5 mb-6 flex items-center justify-around gap-3 tabular-nums">
          <div className="min-w-0">
            <div className="text-xs text-[#a4bba9] mb-0.5 truncate max-w-[8rem]">{myName}</div>
            <div className="font-display text-3xl font-bold text-[#e3ba62]">
              {gameState.gameScore[localPlayer]}
            </div>
          </div>
          <div className="h-8 w-px bg-[#efe9dc]/15 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-[#a4bba9] mb-0.5 truncate max-w-[8rem]">{opponentLabel}</div>
            <div className="font-display text-3xl font-bold text-[#efe9dc]">
              {gameState.gameScore[opponent]}
            </div>
          </div>
        </div>

        {isBot ? (
          <div className="space-y-2.5">
            <button
              type="button"
              data-testid="bot-rematch"
              onClick={requestRematch}
              className="btn-brass w-full font-semibold py-3.5 px-8 rounded-xl cursor-pointer"
            >
              Start a new match
            </button>
            <button
              type="button"
              data-testid="return-to-lobby"
              onClick={onReturnToLobby ?? (() => window.location.reload())}
              className="btn-slate w-full font-semibold py-3 px-6 rounded-xl cursor-pointer text-sm"
            >
              Return to lobby
            </button>
          </div>
        ) : reconnecting && onReturnToLobby ? (
          <div className="space-y-2.5">
            <p
              role="status"
              aria-live="polite"
              className="rounded-xl bg-[#4b3812]/80 border border-[#d4a84b]/45 px-3.5 py-2 text-xs text-[#f4d78b]"
            >
              Reconnecting to opponent…
            </p>
            <button
              type="button"
              onClick={onReturnToLobby}
              className="btn-slate w-full font-semibold py-3.5 px-8 rounded-xl cursor-pointer"
            >
              Return to lobby
            </button>
          </div>
        ) : disconnected && onReturnToLobby ? (
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
          <div className="space-y-2.5">
            {opponentReady && !localReady && (
              <div
                data-testid="opponent-rematch-ready"
                role="status"
                className="flex items-center justify-center gap-2 rounded-xl bg-[#d4a84b]/12 border border-[#d4a84b]/35 px-3 py-1.5 text-xs font-medium text-[#e3ba62]"
              >
                <span className="h-2 w-2 rounded-full bg-[#e3ba62]" aria-hidden="true" />
                Opponent wants a rematch
              </div>
            )}
            <button
              type="button"
              data-testid="play-rematch"
              disabled={localReady}
              onClick={requestRematch}
              className="btn-brass w-full font-semibold py-3.5 px-8 rounded-xl cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {localReady && (
                <span
                  className="h-2 w-2 rounded-full bg-current animate-pulse"
                  aria-hidden="true"
                />
              )}
              {localReady
                ? 'Waiting for opponent…'
                : opponentReady
                  ? 'Accept rematch'
                  : 'Play rematch'}
            </button>
            <button
              type="button"
              data-testid="return-to-lobby"
              onClick={onReturnToLobby ?? (() => window.location.reload())}
              className="btn-slate w-full font-semibold py-3 px-6 rounded-xl cursor-pointer text-sm"
            >
              Return to lobby
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

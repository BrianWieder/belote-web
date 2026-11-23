import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGame } from '../hooks/useGame';
import { useGameStore } from '../store/gameStore';
import { Card, SuitIcon } from './Card';
import { SUIT_NAMES, isRedSuit } from './suits';
import type { PlayerID } from '../game/types';

export function PlayArea() {
  const { gameState, localPlayer } = useGame();
  const gameMode = useGameStore((s) => s.gameMode);
  const prefersReducedMotion = useReducedMotion();
  const [peekTrickCount, setPeekTrickCount] = useState<number | null>(null);
  const peekContainerRef = useRef<HTMLDivElement>(null);

  const isPlaying = Boolean(gameState && gameState.phase === 'playing');
  const trickCount = gameState?.tricks.length ?? 0;
  const lastTrick =
    isPlaying && gameState && trickCount > 0
      ? gameState.tricks[trickCount - 1]
      : null;
  const noCardsPlayed = Boolean(
    gameState &&
      gameState.currentTrick.cards[0] === null &&
      gameState.currentTrick.cards[1] === null,
  );
  const showingLastTrick = noCardsPlayed && lastTrick !== null;
  const canPeekLastTrick = !showingLastTrick && lastTrick !== null;
  const isPeekingLastTrick = canPeekLastTrick && peekTrickCount === trickCount;

  useEffect(() => {
    if (!isPeekingLastTrick) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPeekTrickCount(null);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (
        peekContainerRef.current &&
        !peekContainerRef.current.contains(event.target as Node)
      ) {
        setPeekTrickCount(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isPeekingLastTrick]);

  if (!gameState || gameState.phase !== 'playing') return null;

  const isBot = gameMode === 'bot';
  const oppShort = isBot ? 'Bot' : 'Opp';
  const oppLabel = isBot ? 'Bot' : 'Opponent';
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const trick = gameState.currentTrick;

  // Keep the resolved trick visible on the baize until the next lead is played.
  const displayTrickIndex = showingLastTrick ? trickCount - 1 : trickCount;
  const displayCards = showingLastTrick ? lastTrick!.cards : trick.cards;
  const winner = showingLastTrick ? (lastTrick!.winner ?? null) : null;

  const isMyTurn = gameState.currentPlayer === localPlayer;
  const trumpSuit = gameState.trumpSuit;
  const redTrump = trumpSuit ? isRedSuit(trumpSuit) : false;

  const myBeloteLabel = gameState.rebeloteDeclared[localPlayer]
    ? 'Rebelote!'
    : gameState.beloteDeclared[localPlayer]
      ? 'Belote!'
      : null;
  const oppBeloteLabel = gameState.rebeloteDeclared[opponent]
    ? `${oppShort}: Rebelote!`
    : gameState.beloteDeclared[opponent]
      ? `${oppShort}: Belote!`
      : null;

  const oppCard = displayCards[opponent];
  const myCard = displayCards[localPlayer];
  const lastTrickOppCard = lastTrick?.cards[opponent] ?? null;
  const lastTrickMyCard = lastTrick?.cards[localPlayer] ?? null;
  const lastTrickWinner = lastTrick?.winner ?? null;

  const slotPlaceholder = (active: boolean, label: string) => (
    <div
      className={`w-[3.1rem] h-[4.5rem] tall-sm:w-[4.5rem] tall-sm:h-[6.3rem] ultra-short:h-[4.15rem] rounded-lg tall-sm:rounded-xl border border-dashed flex items-center justify-center text-[11px] text-center px-1 transition-colors ${
        active
          ? 'border-[#d4a84b]/60 bg-[#d4a84b]/8 text-[#e3ba62] font-medium'
          : 'border-[#efe9dc]/16 bg-[#0b1f16]/25 text-[#73907c]'
      }`}
    >
      {label}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-2 ultra-short:gap-1 w-full max-w-md">
      {/* Contract, trick count, last-trick peek, and Belote announcements */}
      <div
        ref={peekContainerRef}
        className="relative flex flex-wrap items-center justify-center gap-2.5 ultra-short:gap-1.5 text-xs"
      >
        {trumpSuit && (
          <div
            data-testid="trump-indicator"
            className="rounded-xl bg-[#11261c]/95 border border-[#d4a84b]/55 shadow-[0_6px_18px_rgba(4,12,8,0.45)] pl-1.5 pr-3 py-1 ultra-short:py-0.5 flex items-center gap-2"
          >
            <span
              aria-hidden="true"
              className={`w-7 h-7 tall-sm:w-8 tall-sm:h-8 ultra-short:w-6 ultra-short:h-6 rounded-lg bg-[#faf6ec] border border-[#d4a84b]/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] flex items-center justify-center shrink-0 ${
                redTrump ? 'text-[#b8262a]' : 'text-[#191c20]'
              }`}
            >
              <SuitIcon
                suit={trumpSuit}
                className="w-4 h-4 tall-sm:w-5 tall-sm:h-5 ultra-short:w-3.5 ultra-short:h-3.5"
              />
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-[9px] tall-sm:text-[10px] uppercase tracking-[0.14em] font-semibold text-[#e3ba62]">
                Trump{gameState.taker !== null ? ` · ${gameState.taker === localPlayer ? 'You' : oppShort}` : ''}
              </span>
              <span className="font-display text-sm tall-sm:text-base ultra-short:text-xs font-semibold text-[#efe9dc] mt-0.5">
                {SUIT_NAMES[trumpSuit]}
              </span>
            </div>
          </div>
        )}

        <div
          data-testid="trick-counter"
          className="ardoise-bar rounded-full px-3 py-1 ultra-short:py-0.5 text-[#a4bba9] tabular-nums"
        >
          Trick {gameState.tricks.length + (showingLastTrick ? 0 : 1)}/16
        </div>

        {canPeekLastTrick && (
          <button
            type="button"
            data-testid="last-trick-toggle"
            aria-expanded={isPeekingLastTrick}
            aria-controls="last-trick-popover"
            onClick={() =>
              setPeekTrickCount(isPeekingLastTrick ? null : trickCount)
            }
            className={`rounded-full px-2.5 py-1 ultra-short:py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
              isPeekingLastTrick
                ? 'bg-[#d4a84b]/20 border border-[#d4a84b]/60 text-[#e3ba62]'
                : 'ardoise-bar text-[#a4bba9] hover:text-[#efe9dc] hover:border-[#d4a84b]/40'
            }`}
          >
            Last trick
          </button>
        )}

        {(myBeloteLabel || oppBeloteLabel) && (
          <div className="rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/50 px-2.5 py-0.5 font-display font-semibold text-[#e3ba62]">
            {myBeloteLabel ?? oppBeloteLabel}
          </div>
        )}

        {isPeekingLastTrick && lastTrick && (
          <div
            id="last-trick-popover"
            data-testid="last-trick-popover"
            role="region"
            aria-label={`Trick ${trickCount} preview`}
            className="ardoise-panel absolute top-full mt-2 left-1/2 -translate-x-1/2 z-30 rounded-xl px-4 py-3 border border-[#d4a84b]/45 w-max max-w-[calc(100vw-2rem)]"
          >
            <div className="flex items-center justify-between gap-4 mb-2.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-display font-semibold text-[#efe9dc] tabular-nums">
                  Trick {trickCount}
                </span>
                <span
                  className={
                    lastTrickWinner === localPlayer
                      ? 'text-[#e3ba62] font-medium'
                      : 'text-[#a4bba9]'
                  }
                >
                  Won by {lastTrickWinner === localPlayer ? 'you' : isBot ? 'Bot' : 'opponent'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPeekTrickCount(null)}
                aria-label="Close last trick preview"
                className="btn-slate w-5 h-5 rounded-md flex items-center justify-center text-xs leading-none cursor-pointer"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-5">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-[#a4bba9]">
                  {oppLabel}{lastTrick.leader === opponent ? ' · Led' : ''}
                </span>
                <div
                  className={
                    lastTrickWinner !== opponent ? 'opacity-50' : ''
                  }
                >
                  {lastTrickOppCard && (
                    <>
                      <Card
                        card={lastTrickOppCard}
                        size="sm"
                        isTrump={Boolean(
                          trumpSuit && lastTrickOppCard.suit === trumpSuit,
                        )}
                        decorative
                      />
                      <span className="sr-only">
                        {lastTrickOppCard.rank} of {SUIT_NAMES[lastTrickOppCard.suit]}
                        {trumpSuit && lastTrickOppCard.suit === trumpSuit ? ', trump' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-[#a4bba9]">
                  You{lastTrick.leader === localPlayer ? ' · Led' : ''}
                </span>
                <div
                  className={
                    lastTrickWinner !== localPlayer ? 'opacity-50' : ''
                  }
                >
                  {lastTrickMyCard && (
                    <>
                      <Card
                        card={lastTrickMyCard}
                        size="sm"
                        isTrump={Boolean(
                          trumpSuit && lastTrickMyCard.suit === trumpSuit,
                        )}
                        decorative
                      />
                      <span className="sr-only">
                        {lastTrickMyCard.rank} of {SUIT_NAMES[lastTrickMyCard.suit]}
                        {trumpSuit && lastTrickMyCard.suit === trumpSuit ? ', trump' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Center pli mat — cards placed side-by-side with natural table offset */}
      <div
        data-testid="play-area"
        className="tapis-ring rounded-2xl px-7 py-3.5 tall-sm:px-11 tall-sm:py-5 ultra-short:py-2 flex items-center justify-center gap-5 sm:gap-8"
      >
        {/* Opponent's card */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-[11px] text-[#a4bba9]">{oppLabel}</span>
          <div
            className={`-translate-y-0.5 -rotate-2 transition-opacity ${
              showingLastTrick && winner !== opponent ? 'opacity-45' : ''
            }`}
          >
            {oppCard ? (
              <motion.div
                key={`opp-${oppCard.rank}-${oppCard.suit}-${displayTrickIndex}`}
                initial={prefersReducedMotion ? false : { opacity: 0, y: -10, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                <Card
                  card={oppCard}
                  isTrump={Boolean(trumpSuit && oppCard.suit === trumpSuit)}
                  decorative
                />
              </motion.div>
            ) : (
              slotPlaceholder(!showingLastTrick && !isMyTurn, !showingLastTrick && !isMyTurn ? 'Thinking' : '')
            )}
          </div>
        </div>

        {/* Local player's card */}
        <div className="flex flex-col items-center gap-1">
          <div
            className={`translate-y-0.5 rotate-2 transition-opacity ${
              showingLastTrick && winner !== localPlayer ? 'opacity-45' : ''
            }`}
          >
            {myCard ? (
              <motion.div
                key={`me-${myCard.rank}-${myCard.suit}-${displayTrickIndex}`}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                <Card
                  card={myCard}
                  isTrump={Boolean(trumpSuit && myCard.suit === trumpSuit)}
                  decorative
                />
              </motion.div>
            ) : (
              slotPlaceholder(!showingLastTrick && isMyTurn, !showingLastTrick && isMyTurn ? 'Play card' : '')
            )}
          </div>
          <span className="text-[11px] text-[#a4bba9]">You</span>
        </div>
      </div>

      {/* Turn & trick tally footer */}
      <div className="flex flex-col items-center gap-0.5 text-xs">
        {showingLastTrick ? (
          <div className="text-center">
            <span className="text-[#a4bba9]">
              Last trick won by {winner === localPlayer ? 'you' : isBot ? 'Bot' : 'opponent'}.{' '}
            </span>
            <span
              className={`font-semibold ${
                isMyTurn ? 'text-[#e3ba62]' : 'text-[#a4bba9]'
              }`}
            >
              {isMyTurn ? 'Your turn to lead' : `${oppLabel} leads next`}
            </span>
          </div>
        ) : (
          <div
            className={`font-medium ${
              isMyTurn ? 'text-[#e3ba62]' : 'text-[#a4bba9]'
            }`}
          >
            {isMyTurn ? 'Your turn to play' : `${oppLabel}'s turn`}
          </div>
        )}

        <div className="flex items-center gap-4 text-[11px] text-[#73907c] tabular-nums">
          <span>Your tricks: {gameState.tricksWon[localPlayer].length / 2}</span>
          <span>{oppLabel}: {gameState.tricksWon[opponent].length / 2}</span>
        </div>
      </div>
    </div>
  );
}

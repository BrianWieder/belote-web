import { motion, useReducedMotion } from 'framer-motion';
import { useGame } from '../hooks/useGame';
import { Card, SuitIcon } from './Card';
import { SUIT_NAMES, isRedSuit } from './suits';
import type { PlayerID } from '../game/types';

export function PlayArea() {
  const { gameState, localPlayer } = useGame();
  const prefersReducedMotion = useReducedMotion();

  if (!gameState || gameState.phase !== 'playing') return null;

  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;
  const trick = gameState.currentTrick;
  const lastTrick =
    gameState.tricks.length > 0
      ? gameState.tricks[gameState.tricks.length - 1]
      : null;

  // Keep the resolved trick visible on the baize until the next lead is played.
  const noCardsPlayed = trick.cards[0] === null && trick.cards[1] === null;
  const showingLastTrick = noCardsPlayed && lastTrick !== null;
  const displayCards = showingLastTrick ? lastTrick.cards : trick.cards;
  const winner = showingLastTrick ? (lastTrick.winner ?? null) : null;

  const isMyTurn = gameState.currentPlayer === localPlayer;
  const trumpSuit = gameState.trumpSuit;
  const redTrump = trumpSuit ? isRedSuit(trumpSuit) : false;

  const myBeloteLabel = gameState.rebeloteDeclared[localPlayer]
    ? 'Rebelote!'
    : gameState.beloteDeclared[localPlayer]
      ? 'Belote!'
      : null;
  const oppBeloteLabel = gameState.rebeloteDeclared[opponent]
    ? 'Opp: Rebelote!'
    : gameState.beloteDeclared[opponent]
      ? 'Opp: Belote!'
      : null;

  const oppCard = displayCards[opponent];
  const myCard = displayCards[localPlayer];

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
      {/* Contract, trick count, and Belote announcements */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 ultra-short:gap-1.5 text-xs">
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
                Trump{gameState.taker !== null ? ` · ${gameState.taker === localPlayer ? 'You' : 'Opp'}` : ''}
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

        {(myBeloteLabel || oppBeloteLabel) && (
          <div className="rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/50 px-2.5 py-0.5 font-display font-semibold text-[#e3ba62]">
            {myBeloteLabel ?? oppBeloteLabel}
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
          <span className="text-[11px] text-[#a4bba9]">Opponent</span>
          <div
            className={`-translate-y-0.5 -rotate-2 transition-opacity ${
              showingLastTrick && winner !== opponent ? 'opacity-45' : ''
            }`}
          >
            {oppCard ? (
              <motion.div
                key={`opp-${oppCard.rank}-${oppCard.suit}-${gameState.tricks.length}`}
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
                key={`me-${myCard.rank}-${myCard.suit}-${gameState.tricks.length}`}
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
              Last trick won by {winner === localPlayer ? 'you' : 'opponent'}.{' '}
            </span>
            <span
              className={`font-semibold ${
                isMyTurn ? 'text-[#e3ba62]' : 'text-[#a4bba9]'
              }`}
            >
              {isMyTurn ? 'Your turn to lead' : 'Opponent leads next'}
            </span>
          </div>
        ) : (
          <div
            className={`font-medium ${
              isMyTurn ? 'text-[#e3ba62]' : 'text-[#a4bba9]'
            }`}
          >
            {isMyTurn ? 'Your turn to play' : "Opponent's turn"}
          </div>
        )}

        <div className="flex items-center gap-4 text-[11px] text-[#73907c] tabular-nums">
          <span>Your tricks: {gameState.tricksWon[localPlayer].length / 2}</span>
          <span>Opponent: {gameState.tricksWon[opponent].length / 2}</span>
        </div>
      </div>
    </div>
  );
}

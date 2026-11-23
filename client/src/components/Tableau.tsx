import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGame, usePlayableCards } from '../hooks/useGame';
import { useGameStore } from '../store/gameStore';
import { resolveCardTap } from '../store/preferences';
import { Card } from './Card';
import { detectUncoveredTableauSlots } from './detectTableauFlip';
import type { Card as CardType, PlayerID, TableauSlot } from '../game/types';
import { cardToString } from '../game/types';

const FLIP_GLOW_DURATION_MS = 950;

interface TableauProps {
  player: PlayerID;
}

export function Tableau({ player }: TableauProps) {
  const {
    gameState,
    localPlayer,
    isConnected,
    playCard,
    isMyTurn,
  } = useGame();
  const playableCards = usePlayableCards();
  const twoTapPlay = useGameStore((s) => s.twoTapPlay);
  const selectedCardKey = useGameStore((s) => s.selectedCardKey);
  const setSelectedCardKey = useGameStore((s) => s.setSelectedCardKey);
  const prefersReducedMotion = useReducedMotion();
  const [revealedSlots, setRevealedSlots] = useState<Record<number, string>>({});

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const clearAllTimers = () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };

    const unsubscribe = useGameStore.subscribe((state, prevState) => {
      if (!state.gameState || state.gameState.phase !== 'playing') {
        clearAllTimers();
        setRevealedSlots({});
        return;
      }

      const flippedIndices = detectUncoveredTableauSlots(
        prevState.gameState?.tableau[player],
        state.gameState.tableau[player],
      );
      if (flippedIndices.length === 0) return;

      const updates: Record<number, string> = {};
      for (const slotIdx of flippedIndices) {
        const revealedCard = state.gameState.tableau[player][slotIdx]?.faceUp;
        if (!revealedCard) continue;
        const cardKey = cardToString(revealedCard);
        updates[slotIdx] = cardKey;

        const existingTimer = timers.get(slotIdx);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        const timer = setTimeout(() => {
          timers.delete(slotIdx);
          setRevealedSlots((current) => {
            if (current[slotIdx] !== cardKey) return current;
            const next = { ...current };
            delete next[slotIdx];
            return next;
          });
        }, FLIP_GLOW_DURATION_MS);
        timers.set(slotIdx, timer);
      }

      if (Object.keys(updates).length > 0) {
        setRevealedSlots((current) => ({ ...current, ...updates }));
      }
    });

    return () => {
      clearAllTimers();
      unsubscribe();
    };
  }, [player]);
  if (!gameState) return null;

  const tableau = gameState.tableau[player];
  const isLocal = player === localPlayer;
  const isPlaying = gameState.phase === 'playing';
  const canAct = isLocal && isPlaying && isMyTurn && isConnected;

  const playableSet = new Set(playableCards.map((c) => cardToString(c)));

  const handleCardClick = (card: CardType) => {
    const key = cardToString(card);
    const outcome = resolveCardTap({
      cardKey: key,
      isPlayable: canAct && playableSet.has(key),
      twoTapPlay,
      selectedCardKey,
    });
    if (outcome.kind === 'select') {
      setSelectedCardKey(outcome.cardKey);
    } else if (outcome.kind === 'play') {
      setSelectedCardKey(null);
      playCard(card);
    }
  };

  return (
    <div
      data-testid={`tableau-${player}`}
      className="flex justify-center gap-2 sm:gap-3.5"
    >
      {tableau.map((slot: TableauSlot, i: number) => {
        const isEmpty = !slot.faceDown && !slot.faceUp;
        if (isEmpty) {
          return (
            <div
              key={i}
              aria-hidden="true"
              className="w-11 h-[5rem] tall-sm:w-14 tall-sm:h-[5.9rem] ultra-short:h-[4.35rem] flex items-center justify-center"
            >
              <div className="w-11 h-[4.25rem] tall-sm:w-14 tall-sm:h-20 ultra-short:h-[3.85rem] rounded-lg border border-dashed border-[#efe9dc]/12 bg-[#0b1f16]/20" />
            </div>
          );
        }

        const faceUpCard = slot.faceUp;
        const faceUpKey = faceUpCard ? cardToString(faceUpCard) : null;
        const isNewlyRevealed = Boolean(faceUpKey && revealedSlots[i] === faceUpKey);
        const canPlay =
          canAct && faceUpKey
            ? playableSet.has(faceUpKey)
            : false;
        const isSelected = Boolean(canPlay && twoTapPlay && faceUpKey && selectedCardKey === faceUpKey);
        const shouldDim = isLocal && isPlaying && isMyTurn && !canPlay;
        const isTrump = Boolean(
          faceUpCard && gameState.trumpSuit && faceUpCard.suit === gameState.trumpSuit,
        );

        return (
          <div
            key={i}
            className={`relative w-11 h-[5rem] tall-sm:w-14 tall-sm:h-[5.9rem] ultra-short:h-[4.35rem] ${
              isSelected ? 'z-20' : ''
            }`}
          >
            {/* Buried face-down card */}
            {slot.faceDown && (
              <div className="absolute top-0 left-0">
                <Card card={{ suit: 'spades', rank: '7' }} faceDown size="sm" />
              </div>
            )}

            {/* Exposed face-up card */}
            {faceUpCard && faceUpKey && (
              <motion.div
                key={faceUpKey}
                initial={
                  isNewlyRevealed
                    ? prefersReducedMotion
                      ? { opacity: 0.35 }
                      : { scaleX: 0, y: -4, opacity: 0.65 }
                    : false
                }
                animate={{ scaleX: 1, y: 0, opacity: 1 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0.16 }
                    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }
                }
                className={`absolute ${
                  slot.faceDown
                    ? 'top-3 tall-sm:top-3.5 ultra-short:top-2'
                    : 'top-1 tall-sm:top-1.5 ultra-short:top-0.5'
                } left-0`}
              >
                {isNewlyRevealed && (
                  <motion.span
                    aria-hidden="true"
                    data-testid={`tableau-flip-glow-${player}-${i}`}
                    initial={
                      prefersReducedMotion
                        ? { opacity: 0.55 }
                        : { opacity: 0.95, scale: 0.96 }
                    }
                    animate={
                      prefersReducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, scale: 1.07 }
                    }
                    transition={{
                      duration: prefersReducedMotion ? 0.35 : 0.85,
                      ease: 'easeOut',
                    }}
                    className="pointer-events-none absolute -inset-[3px] rounded-[10px] ring-2 ring-[#e3ba62] shadow-[0_0_16px_rgba(227,186,98,0.65)]"
                  />
                )}
                <Card
                  card={faceUpCard}
                  playable={canPlay}
                  selected={isSelected}
                  twoTapActive={twoTapPlay}
                  dimmed={shouldDim}
                  isTrump={isTrump}
                  size="sm"
                  onClick={() => handleCardClick(faceUpCard)}
                />
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}

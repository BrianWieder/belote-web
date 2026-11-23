import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import {
  getReactionLabel,
  REACTION_COOLDOWN_MS,
  REACTIONS,
  type ReactionId,
} from '../game/reactions';
import type { PlayerID } from '../game/types';

export function ReactionPopoverButton() {
  const [open, setOpen] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialFocusIndexRef = useRef(0);
  const prefersReducedMotion = useReducedMotion();

  const lastReactionSentAt = useGameStore((s) => s.lastReactionSentAt);
  const sendReaction = useGameStore((s) => s.sendReaction);

  useEffect(() => {
    if (lastReactionSentAt === 0) return;
    const remaining = lastReactionSentAt + REACTION_COOLDOWN_MS - Date.now();
    if (remaining <= 0) return;

    const startTimer = setTimeout(() => setCoolingDown(true), 0);
    const endTimer = setTimeout(() => setCoolingDown(false), remaining);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(endTimer);
    };
  }, [lastReactionSentAt]);

  useEffect(() => {
    if (!open) return;

    const focusTimer = setTimeout(() => {
      itemRefs.current[initialFocusIndexRef.current]?.focus();
    }, 0);

    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = (id: ReactionId) => {
    if (coolingDown) return;
    const sent = sendReaction(id);
    if (sent) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      initialFocusIndexRef.current = 0;
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      initialFocusIndexRef.current = REACTIONS.length - 1;
      setOpen(true);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const count = REACTIONS.length;
    const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = currentIndex < 0 ? 0 : (currentIndex + 1) % count;
      itemRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = currentIndex < 0 ? count - 1 : (currentIndex - 1 + count) % count;
      itemRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      itemRefs.current[count - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid="reaction-button"
        aria-label="Send a quick reaction"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? 'reaction-menu-list' : undefined}
        onClick={() => {
          initialFocusIndexRef.current = 0;
          setOpen((v) => !v);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={`ardoise-bar rounded-xl w-10 h-10 tall-sm:w-11 tall-sm:h-11 ultra-short:w-9 ultra-short:h-9 flex items-center justify-center cursor-pointer transition-colors ${
          open
            ? 'border-[#d4a84b]/65 text-[#e3ba62]'
            : 'text-[#a4bba9] hover:text-[#efe9dc] hover:border-[#d4a84b]/40'
        }`}
        title="Table talk"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 ultra-short:w-4 ultra-short:h-4"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id="reaction-menu-list"
            data-testid="reaction-menu"
            role="menu"
            aria-label="Quick reactions"
            onKeyDown={handleMenuKeyDown}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: prefersReducedMotion ? 0.05 : 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="ardoise-panel absolute right-0 top-full mt-2 z-40 w-44 rounded-xl p-1.5 flex flex-col gap-1"
          >
            {REACTIONS.map((reaction, index) => (
              <button
                key={reaction.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-testid={`reaction-option-${reaction.id}`}
                aria-disabled={coolingDown}
                onClick={() => handleSelect(reaction.id)}
                className={`w-full text-left rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium text-[#efe9dc] hover:bg-[#d4a84b]/15 hover:text-[#e3ba62] focus-visible:bg-[#d4a84b]/15 focus-visible:text-[#e3ba62] focus-visible:outline-none transition-colors ${
                  coolingDown ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                {reaction.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ReactionPillProps {
  player: PlayerID;
  side: 'top' | 'bottom';
}

export function ReactionPill({ player, side }: ReactionPillProps) {
  const reaction = useGameStore((s) => s.activeReactions[player]);
  const clearReaction = useGameStore((s) => s.clearReaction);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!reaction) return;
    const remaining = Math.max(0, reaction.expiresAt - Date.now());
    const timer = setTimeout(() => {
      clearReaction(player, reaction.nonce);
    }, remaining);
    return () => clearTimeout(timer);
  }, [player, reaction, clearReaction]);

  const positionClass =
    side === 'top'
      ? '-bottom-1.5 translate-y-full'
      : '-top-1.5 -translate-y-full';

  return (
    <div
      aria-live="polite"
      role="status"
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${positionClass} z-30`}
    >
      <AnimatePresence mode="wait">
        {reaction && (
          <motion.div
            key={`${reaction.sender}-${reaction.nonce}`}
            data-testid={`reaction-pill-${side}`}
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: side === 'bottom' ? 8 : -8, scale: 0.92 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: side === 'bottom' ? -6 : 6, scale: 0.96 }
            }
            transition={{ duration: prefersReducedMotion ? 0.05 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="ardoise-panel rounded-full border-[#d4a84b]/60 px-3.5 py-1 text-xs sm:text-sm font-display font-semibold text-[#e3ba62] whitespace-nowrap shadow-[0_10px_24px_rgba(4,10,7,0.6)]"
          >
            {getReactionLabel(reaction.id)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

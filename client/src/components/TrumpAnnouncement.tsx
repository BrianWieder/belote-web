import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { SuitIcon } from './Card';
import { SUIT_NAMES, isRedSuit } from './suits';
import {
  detectTrumpAnnouncement,
  type TrumpAnnouncementInfo,
} from './detectTrumpAnnouncement';

const DISPLAY_DURATION_MS = 1800;

export function TrumpAnnouncement() {
  const localPlayer = useGameStore((s) => s.localPlayer);
  const gameMode = useGameStore((s) => s.gameMode);
  const prefersReducedMotion = useReducedMotion();
  const [announcement, setAnnouncement] = useState<TrumpAnnouncementInfo | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const unsubscribe = useGameStore.subscribe((state, prevState) => {
      const detected = detectTrumpAnnouncement(prevState.gameState, state.gameState);
      if (detected) {
        clearTimer();
        setAnnouncement(detected);
        timer = setTimeout(() => {
          setAnnouncement(null);
          timer = null;
        }, DISPLAY_DURATION_MS);
        return;
      }

      if (!state.gameState || state.gameState.phase !== 'playing') {
        clearTimer();
        setAnnouncement(null);
      }
    });

    return () => {
      clearTimer();
      unsubscribe();
    };
  }, []);

  const red = announcement ? isRedSuit(announcement.suit) : false;

  return (
    <div
      aria-live="polite"
      role="status"
      className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none px-4"
    >
      <AnimatePresence>
        {announcement && (
          <motion.div
            key={`trump-${announcement.round}-${announcement.suit}`}
            data-testid="trump-announcement"
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.84, y: 12 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, y: -8 }
            }
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="ardoise-panel rounded-2xl px-8 py-6 sm:px-10 sm:py-7 flex flex-col items-center text-center border border-[#d4a84b]/45"
          >
            <span className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#e3ba62]">
              Trump Suit
            </span>

            <div
              aria-hidden="true"
              className={`my-3 w-20 h-24 sm:w-24 sm:h-28 rounded-xl playing-card flex items-center justify-center relative ${
                red ? 'text-[#b8262a]' : 'text-[#191c20]'
              }`}
            >
              <span className="pointer-events-none absolute inset-[5px] rounded-[7px] border border-[#d4a84b]/60" />
              <SuitIcon
                suit={announcement.suit}
                className="relative z-10 w-12 h-12 sm:w-14 sm:h-14"
              />
            </div>

            <div className="font-display text-3xl sm:text-4xl font-semibold text-[#efe9dc]">
              {SUIT_NAMES[announcement.suit]}
            </div>

            <div className="mt-1 text-xs sm:text-sm text-[#a4bba9]">
              Taken by {announcement.taker === localPlayer ? 'you' : gameMode === 'bot' ? 'Bot' : 'opponent'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

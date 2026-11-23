import { useEffect, useRef, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import {
  clearSavedGame,
  describeSavedPhase,
  formatSavedAt,
  loadSavedGame,
  SAVED_GAME_STORAGE_KEY,
  type SavedGameSnapshot,
} from '../store/savedGame';
import {
  buildInviteUrl,
  parseInviteCode,
  stripInviteParam,
} from '../networking/inviteLink';
import { Card } from './Card';
import type { Card as CardType, GameState } from '../game/types';

function formatJoinError(err: unknown): string {
  if (err instanceof Error && err.message) {
    if (/room not found or full/i.test(err.message)) {
      return 'Room not found or already full. Check the code or ask your opponent for a new link.';
    }
    return err.message;
  }
  return 'Could not join the table. Check the code and try again.';
}

interface LobbyProps {
  peerActions: {
    hostGame: () => Promise<void>;
    resumeGame: (savedState: GameState) => Promise<void>;
    joinGame: (code: string) => Promise<void>;
    cancelConnection: () => void;
  };
}

const FAN_CARDS: { card: CardType; rotate: number; y: number; x: number }[] = [
  { card: { rank: 'J', suit: 'spades' }, rotate: -14, y: 8, x: 10 },
  { card: { rank: '9', suit: 'hearts' }, rotate: -5, y: 1, x: 4 },
  { card: { rank: 'K', suit: 'clubs' }, rotate: 5, y: 1, x: -4 },
  { card: { rank: 'Q', suit: 'diamonds' }, rotate: 14, y: 8, x: -10 },
];

export function Lobby({ peerActions }: LobbyProps) {
  const [initialInviteCode] = useState<string | null>(() =>
    parseInviteCode(window.location.search),
  );
  const [joinCode, setJoinCode] = useState(() => initialInviteCode ?? '');
  const [error, setError] = useState('');
  const [loadingAction, setLoadingAction] = useState<'create' | 'resume' | 'join' | 'retry' | null>(null);
  const [copyCodeStatus, setCopyCodeStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copyLinkStatus, setCopyLinkStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [savedGame, setSavedGame] = useState<SavedGameSnapshot | null>(() => loadSavedGame());
  const prefersReducedMotion = useReducedMotion();

  const copyCodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyLinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyFeedbackGenRef = useRef(0);
  const retryGenRef = useRef(0);
  const autoJoinAttemptedRef = useRef(false);

  const { hostGame, resumeGame, joinGame, cancelConnection } = peerActions;
  const connectionStatus = useGameStore((s) => s.connectionStatus);
  const roomCode = useGameStore((s) => s.roomCode);
  const connectionError = useGameStore((s) => s.connectionError);
  const pendingResumeState = useGameStore((s) => s.pendingResumeState);
  const botDifficulty = useGameStore((s) => s.botDifficulty);
  const setBotDifficulty = useGameStore((s) => s.setBotDifficulty);
  const startBotGame = useGameStore((s) => s.startBotGame);
  const loading = loadingAction !== null;

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === SAVED_GAME_STORAGE_KEY) {
        setSavedGame(loadSavedGame());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const genRef = copyFeedbackGenRef;
    return () => {
      genRef.current++;
      if (copyCodeTimerRef.current) clearTimeout(copyCodeTimerRef.current);
      if (copyLinkTimerRef.current) clearTimeout(copyLinkTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!initialInviteCode || autoJoinAttemptedRef.current) return;

    // Defer by a tick so React StrictMode's simulated unmount/remount (and
    // App's usePeer effect setup) completes before we initiate signaling.
    const timer = setTimeout(() => {
      if (autoJoinAttemptedRef.current) return;
      autoJoinAttemptedRef.current = true;

      const cleanUrl = stripInviteParam(window.location);
      window.history.replaceState(window.history.state, '', cleanUrl);

      if (useGameStore.getState().connectionStatus !== 'disconnected') return;

      const gen = ++retryGenRef.current;
      setLoadingAction('join');
      setError('');
      void joinGame(initialInviteCode)
        .catch((e: unknown) => {
          if (retryGenRef.current === gen) {
            setError(formatJoinError(e));
          }
        })
        .finally(() => {
          if (retryGenRef.current === gen) {
            setLoadingAction(null);
          }
        });
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [initialInviteCode, joinGame]);

  const scheduleStatusReset = (
    timerRef: RefObject<ReturnType<typeof setTimeout> | null>,
    setStatus: (status: 'idle' | 'copied' | 'failed') => void,
    delayMs: number,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStatus('idle');
    }, delayMs);
  };

  const resetCopyFeedback = () => {
    copyFeedbackGenRef.current++;
    if (copyCodeTimerRef.current) {
      clearTimeout(copyCodeTimerRef.current);
      copyCodeTimerRef.current = null;
    }
    if (copyLinkTimerRef.current) {
      clearTimeout(copyLinkTimerRef.current);
      copyLinkTimerRef.current = null;
    }
    setCopyCodeStatus('idle');
    setCopyLinkStatus('idle');
  };

  const handleCancelConnection = () => {
    retryGenRef.current += 1;
    setLoadingAction(null);
    resetCopyFeedback();
    cancelConnection();
  };

  const handleStartBotGame = () => {
    retryGenRef.current += 1;
    setLoadingAction(null);
    setError('');
    resetCopyFeedback();
    // Retire any pending multiplayer peer/signaling session before entering solo mode.
    cancelConnection();
    startBotGame(botDifficulty);
  };

  const handleCreate = async () => {
    const gen = ++retryGenRef.current;
    setLoadingAction('create');
    setError('');
    try {
      await hostGame();
    } catch {
      if (retryGenRef.current === gen) {
        setError('Could not reach the signaling server. Check your connection and try again.');
      }
    } finally {
      if (retryGenRef.current === gen) {
        setLoadingAction(null);
      }
    }
  };

  const handleResume = async () => {
    if (!savedGame) return;
    const gen = ++retryGenRef.current;
    setLoadingAction('resume');
    setError('');
    try {
      await resumeGame(savedGame.gameState);
    } catch {
      if (retryGenRef.current === gen) {
        setError('Could not reach the signaling server. Check your connection and try again.');
      }
    } finally {
      if (retryGenRef.current === gen) {
        setLoadingAction(null);
      }
    }
  };

  const handleDiscardSaved = () => {
    clearSavedGame();
    setSavedGame(null);
  };

  const handleJoin = async () => {
    if (joinCode.length !== 4) {
      setError('Enter all 4 characters of the room code.');
      return;
    }
    const gen = ++retryGenRef.current;
    setLoadingAction('join');
    setError('');
    try {
      await joinGame(joinCode.toUpperCase());
    } catch (e) {
      if (retryGenRef.current === gen) {
        setError(formatJoinError(e));
      }
    } finally {
      if (retryGenRef.current === gen) {
        setLoadingAction(null);
      }
    }
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    const gen = copyFeedbackGenRef.current;
    try {
      await navigator.clipboard.writeText(roomCode);
      if (copyFeedbackGenRef.current !== gen) return;
      setCopyCodeStatus('copied');
      scheduleStatusReset(copyCodeTimerRef, setCopyCodeStatus, 2000);
    } catch {
      if (copyFeedbackGenRef.current !== gen) return;
      setCopyCodeStatus('failed');
      scheduleStatusReset(copyCodeTimerRef, setCopyCodeStatus, 3000);
    }
  };

  const handleCopyLink = async () => {
    if (!roomCode) return;
    const gen = copyFeedbackGenRef.current;
    try {
      await navigator.clipboard.writeText(buildInviteUrl(roomCode));
      if (copyFeedbackGenRef.current !== gen) return;
      setCopyLinkStatus('copied');
      scheduleStatusReset(copyLinkTimerRef, setCopyLinkStatus, 2000);
    } catch {
      if (copyFeedbackGenRef.current !== gen) return;
      setCopyLinkStatus('failed');
      scheduleStatusReset(copyLinkTimerRef, setCopyLinkStatus, 3000);
    }
  };

  if (connectionStatus === 'in-lobby' && roomCode) {
    const resumingRound = pendingResumeState
      ? pendingResumeState.roundScores.length + 1
      : null;

    return (
      <main className="tapis-surface h-full overflow-y-auto overscroll-y-contain flex flex-col items-center px-4 py-8">
        <div className="my-auto w-full max-w-md text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#efe9dc] mb-6">
            Belote Maniée
          </h1>

          <div className="ardoise-panel rounded-2xl p-6 sm:p-8 text-center">
            <p className="text-base font-medium text-[#efe9dc] mb-1">
              {pendingResumeState
                ? 'Waiting for your opponent to rejoin'
                : 'Waiting for your opponent to join'}
            </p>
            <p className="text-sm text-[#a4bba9] mb-5">
              {pendingResumeState && resumingRound !== null
                ? `Resuming Round ${resumingRound} (${pendingResumeState.gameScore[0]}–${pendingResumeState.gameScore[1]}). Share this code or invite link to continue.`
                : 'Share this code or invite link to deal the first hand.'}
            </p>

            <div className="tapis-ring rounded-xl px-5 py-4 mb-3 flex items-center justify-center">
              <div
                data-testid="room-code"
                className="font-display text-3xl sm:text-4xl font-bold tracking-[0.22em] text-[#e3ba62] tabular-nums pl-[0.22em]"
              >
                {roomCode}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <button
                type="button"
                data-testid="copy-code"
                onClick={handleCopyCode}
                className="btn-slate rounded-lg px-3.5 py-2.5 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                {copyCodeStatus === 'copied'
                  ? 'Code copied'
                  : copyCodeStatus === 'failed'
                    ? 'Copy failed'
                    : 'Copy code'}
              </button>
              <button
                type="button"
                data-testid="copy-link"
                onClick={handleCopyLink}
                className="btn-slate rounded-lg border-[#d4a84b]/45 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-[#e3ba62] cursor-pointer"
              >
                {copyLinkStatus === 'copied'
                  ? 'Link copied'
                  : copyLinkStatus === 'failed'
                    ? 'Copy failed'
                    : 'Copy link'}
              </button>
            </div>

            {connectionError && (
              <p
                role="alert"
                className="text-sm text-[#f7b4b6] bg-[#5c1619]/60 border border-[#e45a5e]/35 px-4 py-2.5 rounded-lg mb-4 text-left"
              >
                {connectionError}
              </p>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleCancelConnection}
                className="text-sm text-[#a4bba9] hover:text-[#efe9dc] underline underline-offset-4 cursor-pointer transition-colors"
              >
                Leave table
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (connectionStatus === 'connecting') {
    const retrying = loadingAction === 'retry';
    const handleRetryJoin = async () => {
      if (!roomCode || loading) return;
      const gen = ++retryGenRef.current;
      setLoadingAction('retry');
      setError('');
      try {
        await joinGame(roomCode);
      } catch (e) {
        if (retryGenRef.current === gen) {
          useGameStore.getState().setConnectionError(formatJoinError(e));
        }
      } finally {
        if (retryGenRef.current === gen) {
          setLoadingAction(null);
        }
      }
    };

    return (
      <main className="tapis-surface h-full overflow-y-auto overscroll-y-contain flex flex-col items-center px-4 py-8">
        <div className="my-auto w-full max-w-md text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#efe9dc] mb-6">
            Belote Maniée
          </h1>

          <div className="ardoise-panel rounded-2xl p-6 sm:p-8 text-center">
            <p className="text-base font-medium text-[#efe9dc] mb-2">
              Joining table {roomCode ? <span className="font-display text-[#e3ba62]">{roomCode}</span> : null}…
            </p>
            <p className="text-sm text-[#a4bba9] mb-5">
              Establishing a direct peer-to-peer connection for the deal.
            </p>

            {connectionError && (
              <p
                role="alert"
                className="text-sm text-[#f7b4b6] bg-[#5c1619]/60 border border-[#e45a5e]/35 px-4 py-2.5 rounded-lg mb-4 text-left"
              >
                {connectionError}
              </p>
            )}

            <div className="flex flex-col items-center gap-3">
              {(connectionError || retrying) && roomCode && (
                <button
                  type="button"
                  onClick={handleRetryJoin}
                  disabled={loading}
                  className="btn-gold w-full rounded-lg px-4 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  {retrying ? 'Retrying…' : 'Retry connection'}
                </button>
              )}
              <button
                type="button"
                onClick={handleCancelConnection}
                className="text-sm text-[#a4bba9] hover:text-[#efe9dc] underline underline-offset-4 cursor-pointer transition-colors"
              >
                Back to lobby
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="tapis-surface h-full overflow-y-auto overscroll-y-contain flex flex-col items-center px-4 py-10">
      <div className="my-auto w-full max-w-md flex flex-col items-center">
        {/* Characteristic fanned piquet hand: Jack, 9, King, Queen */}
        <div
          aria-hidden="true"
          className="flex items-end justify-center mb-6 pt-2 select-none"
        >
          {FAN_CARDS.map((item, idx) => (
            <motion.div
              key={`${item.card.rank}-${item.card.suit}`}
              initial={
                prefersReducedMotion
                  ? false
                  : { opacity: 0, y: 18, rotate: 0 }
              }
              animate={{
                opacity: 1,
                y: item.y,
                rotate: item.rotate,
                x: item.x,
              }}
              transition={{
                duration: 0.42,
                delay: idx * 0.055,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="-mx-1.5 sm:-mx-2 origin-bottom"
            >
              <Card card={item.card} decorative />
            </motion.div>
          ))}
        </div>

        {/* Title & concise subject framing */}
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-[#efe9dc] text-center">
          Belote Maniée
        </h1>
        <p className="mt-2 mb-7 text-sm sm:text-base text-[#a4bba9] text-center max-w-sm leading-relaxed">
          Two-player French trick-taking with open tableaus, dealt directly between browsers.
        </p>

        {/* Single cohesive table ledger */}
        <section
          aria-label="Start or join a game"
          className="ardoise-panel w-full rounded-2xl p-6 sm:p-7"
        >
          <button
            id="create-room-button"
            data-testid="create-room"
            type="button"
            onClick={handleCreate}
            disabled={loading}
            className="btn-brass w-full font-semibold text-base py-3.5 px-6 rounded-xl cursor-pointer"
          >
            {loadingAction === 'create' ? 'Opening table…' : 'Create a table'}
          </button>

          {savedGame && (
            <div
              data-testid="saved-game-card"
              className="mt-3.5 rounded-xl border border-[#d4a84b]/35 bg-[#d4a84b]/8 px-4 py-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[#e3ba62] flex items-center gap-1.5">
                  <span>Saved game</span>
                  <span className="text-[#a4bba9]/70 font-normal">·</span>
                  <span className="text-[#a4bba9] font-normal">
                    {formatSavedAt(savedGame.savedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="discard-saved-game"
                  aria-label="Discard saved game"
                  onClick={handleDiscardSaved}
                  disabled={loading}
                  className="text-xs text-[#a4bba9] hover:text-[#efe9dc] cursor-pointer transition-colors disabled:opacity-40"
                >
                  Discard
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-xs sm:text-sm text-[#efe9dc] tabular-nums leading-snug">
                  <span>
                    Round {savedGame.gameState.roundScores.length + 1} ·{' '}
                    {savedGame.gameState.gameScore[0]}–{savedGame.gameState.gameScore[1]}
                  </span>
                  <span className="text-[#a4bba9]">
                    {' '}· {describeSavedPhase(savedGame.gameState)}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="resume-game"
                  onClick={handleResume}
                  disabled={loading}
                  className="btn-slate rounded-lg border-[#d4a84b]/45 px-3.5 py-1.5 text-xs font-semibold text-[#e3ba62] shrink-0 cursor-pointer disabled:opacity-40"
                >
                  {loadingAction === 'resume' ? 'Opening…' : 'Resume'}
                </button>
              </div>
            </div>
          )}

          <div className="relative my-5 flex items-center">
            <div className="flex-grow border-t border-[#efe9dc]/12" />
            <span className="mx-3 text-xs text-[#a4bba9]">or join with a code</span>
            <div className="flex-grow border-t border-[#efe9dc]/12" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleJoin();
            }}
            className="flex gap-2.5"
          >
            <label htmlFor="join-code-input" className="sr-only">
              4-character room code
            </label>
            <input
              id="join-code-input"
              data-testid="join-code-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={joinCode}
              onChange={(e) => {
                setError('');
                setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4));
              }}
              placeholder="Code"
              className="w-36 sm:w-40 tapis-ring rounded-xl px-3.5 py-3 text-center font-display text-xl font-semibold tracking-[0.2em] text-[#efe9dc] tabular-nums placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-[#73907c]"
            />
            <button
              id="join-room-button"
              data-testid="join-room"
              type="submit"
              disabled={loading || joinCode.length !== 4}
              className="btn-slate flex-1 font-semibold text-sm sm:text-base py-3 px-4 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loadingAction === 'join' ? 'Joining…' : 'Join table'}
            </button>
          </form>

          <div className="relative my-5 flex items-center">
            <div className="flex-grow border-t border-[#efe9dc]/12" />
            <span className="mx-3 text-xs text-[#a4bba9]">or play solo</span>
            <div className="flex-grow border-t border-[#efe9dc]/12" />
          </div>

          <div className="flex items-center gap-2.5">
            <div
              role="group"
              aria-label="Bot difficulty"
              className="tapis-ring rounded-xl p-1 flex items-center shrink-0"
            >
              <button
                type="button"
                data-testid="bot-difficulty-casual"
                aria-pressed={botDifficulty === 'casual'}
                onClick={() => setBotDifficulty('casual')}
                disabled={loading}
                className={`px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                  botDifficulty === 'casual'
                    ? 'bg-[#d4a84b]/20 text-[#e3ba62] border border-[#d4a84b]/45'
                    : 'text-[#a4bba9] hover:text-[#efe9dc] border border-transparent'
                }`}
              >
                Casual
              </button>
              <button
                type="button"
                data-testid="bot-difficulty-smart"
                aria-pressed={botDifficulty === 'smart'}
                onClick={() => setBotDifficulty('smart')}
                disabled={loading}
                className={`px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                  botDifficulty === 'smart'
                    ? 'bg-[#d4a84b]/20 text-[#e3ba62] border border-[#d4a84b]/45'
                    : 'text-[#a4bba9] hover:text-[#efe9dc] border border-transparent'
                }`}
              >
                Smart
              </button>
            </div>
            <button
              id="play-vs-bot-button"
              data-testid="play-vs-bot"
              type="button"
              onClick={handleStartBotGame}
              disabled={loading}
              className="btn-slate flex-1 font-semibold text-sm sm:text-base py-3 px-4 rounded-xl border-[#d4a84b]/40 text-[#e3ba62] cursor-pointer disabled:opacity-40"
            >
              Play vs. Bot
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 text-sm text-[#f7b4b6] bg-[#5c1619]/60 border border-[#e45a5e]/35 px-3.5 py-2.5 rounded-lg"
            >
              {error}
            </p>
          )}
        </section>

        {/* Quiet expandable rules reference */}
        <details className="mt-5 w-full text-sm text-[#a4bba9] group">
          <summary className="cursor-pointer list-none text-center hover:text-[#efe9dc] transition-colors select-none">
            <span className="underline decoration-[#a4bba9]/40 underline-offset-4">
              How Belote Maniée works
            </span>
          </summary>
          <div className="mt-3 ardoise-bar rounded-xl p-4 text-xs sm:text-sm leading-relaxed text-[#d6dfd8] space-y-2">
            <p>
              Each player holds 8 cards in hand plus 4 tableau stacks (one face-up card resting on one hidden card). Face-up tableau cards play just like cards in your hand and uncover the card beneath.
            </p>
            <p>
              <strong className="text-[#efe9dc] font-semibold">Trump order:</strong>{' '}
              J (20), 9 (14), A (11), 10 (10), K (4), Q (3), 8, 7. Follow suit when able; otherwise trump, and overtrump when possible.
            </p>
            <p>
              <strong className="text-[#efe9dc] font-semibold">Scoring:</strong>{' '}
              152 card points + 10 for the last trick (+20 for King &amp; Queen of trump). If the taker fails to outscore the defender, the defender wins all 162 points (<em>dedans</em>). First to 1,000 wins.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}

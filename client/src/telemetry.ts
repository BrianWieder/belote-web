import type { GameState, PlayerID } from './game/types';

type SentryModule = typeof import('@sentry/react');

let sentryModule: SentryModule | null = null;
let sentryLoadPromise: Promise<SentryModule | null> | null = null;

export function initTelemetry(): Promise<SentryModule | null> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return Promise.resolve(null);

  if (!sentryLoadPromise) {
    sentryLoadPromise = import('@sentry/react')
      .then((Sentry) => {
        Sentry.init({
          dsn,
          enabled: true,
          integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
          ],
          // Performance monitoring — sample 100% in dev, 20% in prod
          tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
          // Session Replay — capture 10% of sessions, 100% of sessions with errors
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0,
          environment: import.meta.env.PROD ? 'production' : 'development',
        });
        sentryModule = Sentry;
        return Sentry;
      })
      .catch(() => null);
  }

  return sentryLoadPromise;
}

function withSentry(callback: (Sentry: SentryModule) => void): void {
  if (sentryModule) {
    callback(sentryModule);
    return;
  }
  if (sentryLoadPromise) {
    void sentryLoadPromise.then((Sentry) => {
      if (Sentry) callback(Sentry);
    });
  }
}

export function setGameContext(gameState: GameState | null, localPlayer: PlayerID): void {
  if (!gameState) return;
  withSentry((Sentry) => {
    Sentry.setContext('game', {
      seed: gameState.seed,
      phase: gameState.phase,
      dealer: gameState.dealer,
      currentPlayer: gameState.currentPlayer,
      trumpSuit: gameState.trumpSuit,
      taker: gameState.taker,
      sequenceNumber: gameState.sequenceNumber,
      gameScore: gameState.gameScore,
      roundNumber: gameState.roundScores.length + 1,
    });
    Sentry.setTag('playerRole', localPlayer === 0 ? 'host' : 'guest');
    Sentry.setTag('gamePhase', gameState.phase);
  });
}

export function addGameBreadcrumb(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  data?: object,
): void {
  withSentry((Sentry) => {
    Sentry.addBreadcrumb({
      category: 'game',
      message,
      level,
      data: data as Record<string, unknown> | undefined,
    });
  });
}

export function captureException(
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  withSentry((Sentry) => {
    Sentry.captureException(error, extra ? { extra } : undefined);
  });
}

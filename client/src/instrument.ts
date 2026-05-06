import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  
  // Only enable in production (or when DSN is explicitly set in dev)
  enabled: !!import.meta.env.VITE_SENTRY_DSN,

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

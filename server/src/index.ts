import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { pathToFileURL } from 'url';
import path from 'path';
import { Server } from 'socket.io';
import cors from 'cors';
import { setupSignaling } from './signaling.js';
import { stopRoomCleanup } from './rooms.js';
import {
  DEFAULT_STUN_SERVERS,
  getIceServers,
  type IceServerConfig,
} from './iceServers.js';

export const DEFAULT_CLIENT_URL = 'http://localhost:5173';

export function parseAllowedOrigins(
  clientUrl: string | undefined = process.env.CLIENT_URL,
): string | string[] {
  const raw = clientUrl?.trim();
  if (!raw) {
    return DEFAULT_CLIENT_URL;
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return DEFAULT_CLIENT_URL;
  }

  return origins.length === 1 ? origins[0] : origins;
}

export interface CreateSignalingServerOptions {
  clientUrl?: string;
  getIceServersFn?: () => Promise<IceServerConfig[]>;
}

export function createSignalingServer(
  options: CreateSignalingServerOptions = {},
): {
  app: express.Express;
  httpServer: HttpServer;
  io: Server;
} {
  const allowedOrigins = parseAllowedOrigins(options.clientUrl);
  const fetchIceServers = options.getIceServersFn ?? (() => getIceServers());

  const app = express();
  app.use(cors({ origin: allowedOrigins }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
  });

  setupSignaling(io);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/ice-servers', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const iceServers = await fetchIceServers();
      res.json({ iceServers });
    } catch (err) {
      console.error('Error resolving ICE servers:', err);
      res.json({
        iceServers: DEFAULT_STUN_SERVERS.map((s) => ({ ...s })),
      });
    }
  });

  return { app, httpServer, io };
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const { httpServer, io } = createSignalingServer();
  const PORT = parseInt(process.env.PORT || '3001', 10);

  httpServer.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    stopRoomCleanup();

    const forceTimer = setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    io.close(() => {
      if (httpServer.listening) {
        httpServer.close(() => {
          clearTimeout(forceTimer);
          process.exit(0);
        });
      } else {
        clearTimeout(forceTimer);
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

import SimplePeer from 'simple-peer';
import { getSocket, sendSignal, SERVER_URL } from './signaling';
import type { GameAction, GameState } from '../game/types';

export type PeerMessage =
  | { type: 'sync-seed'; seed: string; dealer: 0 | 1 }
  | { type: 'resume-game'; state: GameState }
  | { type: 'game-action'; action: GameAction; seq: number }
  | { type: 'new-round'; seq?: number }
  | { type: 'resync-request' }
  | { type: 'game-state'; state: GameState };

type MessageHandler = (msg: PeerMessage) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;

export const DEFAULT_STUN_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

// Exceeds the server's 5s Metered cold-cache fetch timeout plus transport overhead
export const ICE_SERVERS_TIMEOUT_MS = 6_500;
export const ICE_SERVERS_CACHE_TTL_MS = 5 * 60 * 1000;

let peer: SimplePeer.Instance | null = null;
let peerConnected = false;
let peerGeneration = 0;
let pendingSignals: SimplePeer.SignalData[] = [];
let messageHandler: MessageHandler | null = null;
let statusHandler: StatusHandler | null = null;
let roomCode: string = '';
let signalHandler: ((data: { signal: unknown }) => void) | null = null;

const iceServersCache = new Map<string, { servers: RTCIceServer[]; expiresAt: number }>();
const inFlightIceServers = new Map<string, Promise<RTCIceServer[]>>();
let iceCacheGeneration = 0;

function cloneIceServers(servers: readonly RTCIceServer[]): RTCIceServer[] {
  return servers.map((server) => ({
    ...server,
    urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
  }));
}

function buildLegacyTurnServers(
  username?: string,
  credential?: string,
): RTCIceServer[] {
  if (!username || !credential) return [];
  return [
    {
      urls: 'turn:global.relay.metered.ca:80',
      username,
      credential,
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username,
      credential,
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username,
      credential,
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username,
      credential,
    },
  ];
}

export function hasTurnServer(servers: readonly RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(
      (url) => typeof url === 'string' && /^turns?:/i.test(url.trim()),
    );
  });
}

function isValidIceUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  const match = /^(stuns?|turns?):([^?\s#]+)(?:\?([^\s#]+))?$/i.exec(trimmed);
  if (!match) return false;

  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const query = match[3];

  // Reject slashes, credentials, or empty authority (RFC 7064 / RFC 7065 use scheme:host[:port])
  if (authority.includes('/') || authority.includes('@')) return false;

  // Validate optional query parameter (only ?transport=udp|tcp on turn/turns)
  if (query !== undefined) {
    if (scheme !== 'turn' && scheme !== 'turns') return false;
    if (!/^transport=(?:udp|tcp)$/i.test(query)) return false;
  }

  // Validate optional explicit port (1..65535)
  let hostPart = authority;
  if (authority.startsWith('[')) {
    const closeIdx = authority.indexOf(']');
    if (closeIdx === -1) return false;
    hostPart = authority.slice(0, closeIdx + 1);
    const suffix = authority.slice(closeIdx + 1);
    if (suffix.length > 0) {
      if (!/^:\d{1,5}$/.test(suffix)) return false;
      const portNum = Number(suffix.slice(1));
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return false;
    }
  } else {
    const colonIdx = authority.indexOf(':');
    if (colonIdx !== -1) {
      hostPart = authority.slice(0, colonIdx);
      const portStr = authority.slice(colonIdx + 1);
      if (!/^\d{1,5}$/.test(portStr)) return false;
      const portNum = Number(portStr);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return false;
    }
  }

  if (hostPart.length === 0) return false;

  try {
    const parsed = new URL(`http://${authority}`);
    return (
      parsed.hostname.length > 0 &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

function isValidIceServer(entry: unknown): entry is RTCIceServer {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return false;
  }
  const candidate = entry as Record<string, unknown>;
  const validUrls =
    isValidIceUrl(candidate.urls) ||
    (Array.isArray(candidate.urls) &&
      candidate.urls.length > 0 &&
      candidate.urls.every(isValidIceUrl));
  if (!validUrls) return false;
  if (candidate.username !== undefined && typeof candidate.username !== 'string') {
    return false;
  }
  if (
    candidate.credential !== undefined &&
    typeof candidate.credential !== 'string'
  ) {
    return false;
  }
  const urls = Array.isArray(candidate.urls) ? candidate.urls : [candidate.urls];
  const includesTurn = urls.some((u) => /^turns?:/i.test(u.trim()));
  if (
    includesTurn &&
    (typeof candidate.username !== 'string' ||
      typeof candidate.credential !== 'string')
  ) {
    return false;
  }
  return true;
}

export function isValidSignalData(value: unknown): value is SimplePeer.SignalData {
  if (typeof value === 'string') return value.length > 0;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const hasCandidateObject =
    typeof obj.candidate === 'object' &&
    obj.candidate !== null &&
    !Array.isArray(obj.candidate);
  if (typeof obj.type === 'string') {
    if (obj.type === 'candidate') {
      return hasCandidateObject;
    }
    return (
      obj.type === 'offer' ||
      obj.type === 'answer' ||
      obj.type === 'pranswer' ||
      obj.type === 'rollback' ||
      obj.type === 'renegotiate' ||
      obj.type === 'transceiverRequest'
    );
  }
  return hasCandidateObject;
}

export function clearIceServersCache(): void {
  iceCacheGeneration++;
  iceServersCache.clear();
  inFlightIceServers.clear();
}

export interface GetIceServersOptions {
  serverUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  legacyTurnUsername?: string;
  legacyTurnCredential?: string;
}

async function fetchIceServersFromServer(
  options: GetIceServersOptions = {},
): Promise<{ servers: RTCIceServer[]; cacheable: boolean }> {
  const {
    serverUrl = SERVER_URL,
    fetchImpl = fetch,
    timeoutMs = ICE_SERVERS_TIMEOUT_MS,
  } = options;
  const legacyTurnUsername =
    'legacyTurnUsername' in options
      ? options.legacyTurnUsername
      : import.meta.env.VITE_TURN_USERNAME;
  const legacyTurnCredential =
    'legacyTurnCredential' in options
      ? options.legacyTurnCredential
      : import.meta.env.VITE_TURN_CREDENTIAL;

  const endpoint = `${serverUrl.replace(/\/+$/, '')}/ice-servers`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    const rawList =
      typeof payload === 'object' &&
      payload !== null &&
      Array.isArray((payload as { iceServers?: unknown }).iceServers)
        ? (payload as { iceServers: unknown[] }).iceServers
        : null;

    if (!rawList) {
      throw new Error('Invalid ICE servers response shape');
    }

    const serverIceServers = rawList.filter(isValidIceServer);
    if (serverIceServers.length === 0) {
      throw new Error('Server returned no valid ICE servers');
    }

    if (hasTurnServer(serverIceServers)) {
      return { servers: cloneIceServers(serverIceServers), cacheable: true };
    }

    // Backwards-compatible fallback: if the server returned STUN-only and
    // legacy client TURN env vars are configured, append them. Do not cache
    // degraded STUN-only responses so retries can pick up TURN once recovered.
    const legacyTurn = buildLegacyTurnServers(
      legacyTurnUsername,
      legacyTurnCredential,
    );
    return {
      servers: [...cloneIceServers(serverIceServers), ...legacyTurn],
      cacheable: legacyTurn.length > 0,
    };
  } catch (err) {
    console.warn('Failed to fetch ICE servers from signaling server, using fallback:', err);
    const legacyTurn = buildLegacyTurnServers(
      legacyTurnUsername,
      legacyTurnCredential,
    );
    return {
      servers: [...cloneIceServers(DEFAULT_STUN_SERVERS), ...legacyTurn],
      cacheable: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getIceServers(
  options?: GetIceServersOptions,
): Promise<RTCIceServer[]> {
  const serverUrl = options?.serverUrl ?? SERVER_URL;
  const endpoint = `${serverUrl.replace(/\/+$/, '')}/ice-servers`;
  const now = options?.now ?? Date.now;
  const cacheTtlMs = options?.cacheTtlMs ?? ICE_SERVERS_CACHE_TTL_MS;

  const cached = iceServersCache.get(endpoint);
  if (cached && now() < cached.expiresAt) {
    return cloneIceServers(cached.servers);
  }

  const existingInFlight = inFlightIceServers.get(endpoint);
  if (existingInFlight) {
    const resolved = await existingInFlight;
    return cloneIceServers(resolved);
  }

  const cacheGen = iceCacheGeneration;
  const request = fetchIceServersFromServer(options).then(
    ({ servers, cacheable }) => {
      if (cacheGen === iceCacheGeneration) {
        if (cacheable && cacheTtlMs > 0) {
          iceServersCache.set(endpoint, { servers, expiresAt: now() + cacheTtlMs });
        } else {
          iceServersCache.delete(endpoint);
        }
        if (inFlightIceServers.get(endpoint) === request) {
          inFlightIceServers.delete(endpoint);
        }
      }
      return servers;
    },
  );

  inFlightIceServers.set(endpoint, request);
  const resolved = await request;
  return cloneIceServers(resolved);
}

export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

export function setStatusHandler(handler: StatusHandler): void {
  statusHandler = handler;
}

export async function createPeer(isInitiator: boolean, code: string): Promise<void> {
  // Tear down any previous peer instance before starting a new connection
  destroyPeer();

  const generation = ++peerGeneration;
  roomCode = code;
  pendingSignals = [];

  // Register the signal listener synchronously before awaiting ICE servers so
  // offers/candidates arriving while the fetch is in flight are never dropped.
  const socket = getSocket();
  if (signalHandler) socket.off('signal', signalHandler);
  signalHandler = (data: { signal: unknown }) => {
    if (generation !== peerGeneration) return;
    if (!data || !isValidSignalData(data.signal)) return;
    if (peer) {
      peer.signal(data.signal);
    } else {
      pendingSignals.push(data.signal);
    }
  };
  socket.on('signal', signalHandler);

  statusHandler?.('connecting');

  const iceServers = await getIceServers();

  // Abort if destroyPeer() or a newer createPeer() ran while fetching ICE servers
  if (generation !== peerGeneration) {
    return;
  }

  let nextPeer: SimplePeer.Instance;
  try {
    nextPeer = new SimplePeer({
      initiator: isInitiator,
      trickle: true,
      config: { iceServers },
    });
  } catch (err) {
    console.error('Failed to initialize peer connection:', err);
    if (generation === peerGeneration) {
      pendingSignals = [];
      if (signalHandler) {
        socket.off('signal', signalHandler);
        signalHandler = null;
      }
      peerConnected = false;
      statusHandler?.('disconnected');
    }
    return;
  }
  peer = nextPeer;

  nextPeer.on('signal', (signal) => {
    if (peer !== nextPeer) return;
    sendSignal(roomCode, signal);
  });

  nextPeer.on('connect', () => {
    if (peer !== nextPeer) return;
    peerConnected = true;
    statusHandler?.('connected');
  });

  nextPeer.on('data', (data: Uint8Array) => {
    if (peer !== nextPeer) return;
    // Mark as connected when we receive data (fallback for environments
    // where peer.connected isn't set reliably)
    if (!peerConnected) {
      peerConnected = true;
      statusHandler?.('connected');
    }
    const msg = JSON.parse(new TextDecoder().decode(data)) as PeerMessage;
    messageHandler?.(msg);
  });

  nextPeer.on('close', () => {
    if (peer !== nextPeer) return;
    peerConnected = false;
    statusHandler?.('disconnected');
  });

  nextPeer.on('error', (err) => {
    if (peer !== nextPeer) return;
    console.error('Peer error:', err);
    statusHandler?.('disconnected');
  });

  // Replay any signaling payloads received while ICE servers were loading
  const queued = pendingSignals.splice(0, pendingSignals.length);
  for (const signalData of queued) {
    if (peer !== nextPeer) break;
    nextPeer.signal(signalData);
  }
}

export function sendPeerMessage(msg: PeerMessage): boolean {
  if (peer && peerConnected) {
    peer.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function destroyPeer(): void {
  peerGeneration++;
  pendingSignals = [];

  if (signalHandler) {
    getSocket().off('signal', signalHandler);
    signalHandler = null;
  }

  if (peer) {
    const oldPeer = peer;
    peer = null;
    peerConnected = false;
    oldPeer.destroy();
  }
}

export function isPeerConnected(): boolean {
  return peerConnected;
}

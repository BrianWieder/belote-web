import { getSocket, sendSignal, SERVER_URL } from './signaling';
import { isValidGameState, isValidResumableGameState } from '../store/savedGame';
import type { GameAction, GameState, Rank, Suit } from '../game/types';

export type PeerMessage =
  | { type: 'sync-seed'; seed: string; dealer: 0 | 1 }
  | { type: 'resume-game'; state: GameState }
  | { type: 'game-action'; action: GameAction; seq: number }
  | { type: 'new-round'; seq?: number }
  | { type: 'resync-request' }
  | { type: 'game-state'; state: GameState };

export type PeerStatus = 'connecting' | 'connected' | 'disconnected';

export type SignalPayload =
  | { type: 'offer'; sdp: string; offerId?: string; negotiationId?: number }
  | { type: 'answer'; sdp: string; offerId?: string; negotiationId?: number }
  | { type: 'candidate'; candidate: RTCIceCandidateInit; negotiationId?: number };

export interface CreatePeerOptions {
  /** Timeout (ms) waiting for initial data channel open. 0 disables it. */
  setupTimeoutMs?: number;
  /** Grace window (ms) before transient ICE 'disconnected' becomes 'disconnected'. */
  iceDisconnectGraceMs?: number;
  /** Optional explicit ICE servers (skips `/ice-servers` fetch when provided). */
  iceServers?: RTCIceServer[];
  /** Optional server negotiation ID to filter stale signals from earlier connections. */
  negotiationId?: number;
  /** Optional pre-buffered signals for this negotiation to replay once RTCPeerConnection initializes. */
  initialSignals?: SignalPayload[];
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

type MessageHandler = (msg: PeerMessage) => void;
type StatusHandler = (status: PeerStatus) => void;

export const DEFAULT_STUN_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

// Exceeds the server's 5s Metered cold-cache fetch timeout plus transport overhead
export const ICE_SERVERS_TIMEOUT_MS = 6_500;
export const ICE_SERVERS_CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_SETUP_TIMEOUT_MS = 18_000;
const DEFAULT_ICE_DISCONNECT_GRACE_MS = 2_000;

const VALID_SUITS = new Set<Suit>(['hearts', 'diamonds', 'clubs', 'spades']);
const VALID_RANKS = new Set<Rank>(['7', '8', '9', '10', 'J', 'Q', 'K', 'A']);

let pc: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;
let peerConnected = false;
let hasEverConnected = false;
let currentIsInitiator = false;
let roomCode = '';
let generation = 0;

let makingOffer = false;
let hasRemoteDescription = false;
let remoteIceUfrag: string | null = null;
let offerSequence = 0;
let pendingOfferId: string | null = null;
const MAX_PENDING_CANDIDATES = 128;
const MAX_PENDING_CANDIDATE_BYTES = 64 * 1024;

let currentNegotiationId: number | undefined;
let signalQueue: Promise<void> = Promise.resolve();
let pendingSignals: SignalPayload[] = [];
let pendingCandidates: Array<{ candidate: RTCIceCandidateInit; bytes: number }> = [];
let pendingCandidateBytes = 0;
const retiredRemoteIceUfrags = new Set<string>();
let lastEmittedStatus: PeerStatus | null = null;

let setupTimer: ReturnType<typeof setTimeout> | null = null;
let iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
let signalHandler: ((data: { signal: unknown; roomCode?: unknown }) => void) | null = null;

let messageHandler: MessageHandler | null = null;
let statusHandler: StatusHandler | null = null;

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

export function clearIceServersCache(): void {
  iceCacheGeneration++;
  iceServersCache.clear();
  inFlightIceServers.clear();
}

function buildIceServersEndpoint(serverUrl: string): string {
  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    } else if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    }
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.toString().replace(/\/+$/, '')}/ice-servers`;
  } catch {
    return `${serverUrl.replace(/\/+$/, '')}/ice-servers`;
  }
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

  const endpoint = buildIceServersEndpoint(serverUrl);
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

export function isSignalPayload(value: unknown): value is SignalPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.negotiationId !== undefined && !isNonNegativeInt(payload.negotiationId)) {
    return false;
  }
  if (payload.type === 'offer' || payload.type === 'answer') {
    if (typeof payload.sdp !== 'string') return false;
    if (payload.offerId !== undefined && typeof payload.offerId !== 'string') {
      return false;
    }
    return true;
  }
  if (payload.type === 'candidate') {
    return (
      typeof payload.candidate === 'object' &&
      payload.candidate !== null &&
      !Array.isArray(payload.candidate)
    );
  }
  return false;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidCardKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('_');
  if (parts.length !== 2) return false;
  const [rank, suit] = parts;
  return VALID_RANKS.has(rank as Rank) && VALID_SUITS.has(suit as Suit);
}

function isValidGameAction(value: unknown): value is GameAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'bid-take':
    case 'bid-pass':
      return true;
    case 'bid-choose':
      return typeof action.suit === 'string' && VALID_SUITS.has(action.suit as Suit);
    case 'play-card':
      return isValidCardKey(action.card);
    default:
      return false;
  }
}

export function isPeerMessage(value: unknown): value is PeerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const msg = value as Record<string, unknown>;
  switch (msg.type) {
    case 'sync-seed':
      return (
        typeof msg.seed === 'string' &&
        msg.seed.length > 0 &&
        (msg.dealer === 0 || msg.dealer === 1)
      );
    case 'resume-game':
      return isValidResumableGameState(msg.state);
    case 'game-action':
      return isValidGameAction(msg.action) && isNonNegativeInt(msg.seq);
    case 'new-round':
      return msg.seq === undefined || isNonNegativeInt(msg.seq);
    case 'resync-request':
      return true;
    case 'game-state':
      return isValidGameState(msg.state);
    default:
      return false;
  }
}

function clearTimers(): void {
  if (setupTimer !== null) {
    clearTimeout(setupTimer);
    setupTimer = null;
  }
  if (iceDisconnectTimer !== null) {
    clearTimeout(iceDisconnectTimer);
    iceDisconnectTimer = null;
  }
}

function emitStatus(gen: number, status: PeerStatus): void {
  if (gen !== generation) return;
  if (lastEmittedStatus === status) return;
  lastEmittedStatus = status;
  statusHandler?.(status);
}

function teardownConnection(): void {
  clearTimers();

  if (signalHandler) {
    const socket = getSocket();
    socket.off('signal', signalHandler);
    signalHandler = null;
  }

  if (dataChannel) {
    dataChannel.onopen = null;
    dataChannel.onmessage = null;
    dataChannel.onclose = null;
    dataChannel.onerror = null;
    try {
      dataChannel.close();
    } catch {
      // Ignore close errors on already-closed channels
    }
    dataChannel = null;
  }

  if (pc) {
    pc.onicecandidate = null;
    pc.ondatachannel = null;
    pc.oniceconnectionstatechange = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      // Ignore close errors on already-closed connections
    }
    pc = null;
  }

  peerConnected = false;
  hasEverConnected = false;
  makingOffer = false;
  hasRemoteDescription = false;
  remoteIceUfrag = null;
  pendingOfferId = null;
  currentNegotiationId = undefined;
  signalQueue = Promise.resolve();
  pendingSignals = [];
  pendingCandidates = [];
  pendingCandidateBytes = 0;
  retiredRemoteIceUfrags.clear();
  lastEmittedStatus = null;
}

function extractIceUfrag(sdp: string | undefined): string | null {
  if (!sdp) return null;
  const match = /^a=ice-ufrag:(\S+)/m.exec(sdp);
  return match ? match[1] : null;
}

function updateRemoteIceUfrag(sdp: string | undefined): void {
  const nextUfrag = extractIceUfrag(sdp);
  if (remoteIceUfrag !== null && nextUfrag !== null && nextUfrag !== remoteIceUfrag) {
    retiredRemoteIceUfrags.add(remoteIceUfrag);
  }
  remoteIceUfrag = nextUfrag;
  if (nextUfrag !== null) {
    retiredRemoteIceUfrags.delete(nextUfrag);
  }
}

function candidateMatchesRemoteUfrag(candidate: RTCIceCandidateInit): boolean {
  if (!candidate.usernameFragment || remoteIceUfrag === null) {
    return true;
  }
  return candidate.usernameFragment === remoteIceUfrag;
}

function queuePendingCandidate(candidate: RTCIceCandidateInit): void {
  if (candidate.usernameFragment && retiredRemoteIceUfrags.has(candidate.usernameFragment)) {
    return;
  }
  const bytes = JSON.stringify(candidate).length * 2;
  if (
    pendingCandidates.length >= MAX_PENDING_CANDIDATES ||
    pendingCandidateBytes + bytes > MAX_PENDING_CANDIDATE_BYTES
  ) {
    return;
  }
  pendingCandidates.push({ candidate, bytes });
  pendingCandidateBytes += bytes;
}

async function flushPendingCandidates(conn: RTCPeerConnection, gen: number): Promise<void> {
  if (pendingCandidates.length === 0) return;
  const queued = pendingCandidates;
  pendingCandidates = [];
  pendingCandidateBytes = 0;
  for (const entry of queued) {
    if (gen !== generation || pc !== conn) return;
    if (
      entry.candidate.usernameFragment &&
      retiredRemoteIceUfrags.has(entry.candidate.usernameFragment)
    ) {
      continue;
    }
    if (!candidateMatchesRemoteUfrag(entry.candidate)) {
      // Retain candidates belonging to an ICE restart generation whose SDP has not arrived yet.
      queuePendingCandidate(entry.candidate);
      continue;
    }
    try {
      await conn.addIceCandidate(entry.candidate);
    } catch (err) {
      console.warn('Failed to add queued ICE candidate:', err);
    }
  }
}

async function createAndSendOffer(
  conn: RTCPeerConnection,
  gen: number,
  iceRestart: boolean,
): Promise<boolean> {
  if (gen !== generation || pc !== conn) return false;
  makingOffer = true;
  const offerId = `${gen}-${++offerSequence}`;
  try {
    const offer = await conn.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (gen !== generation || pc !== conn) return false;
    await conn.setLocalDescription(offer);
    if (gen !== generation || pc !== conn) return false;
    if (offer.sdp) {
      pendingOfferId = offerId;
      sendSignal(roomCode, {
        type: 'offer',
        sdp: offer.sdp,
        offerId,
        ...(currentNegotiationId !== undefined
          ? { negotiationId: currentNegotiationId }
          : {}),
      } satisfies SignalPayload);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to create WebRTC offer:', err);
    return false;
  } finally {
    if (gen === generation) {
      makingOffer = false;
    }
  }
}

async function handleIncomingSignal(
  conn: RTCPeerConnection,
  gen: number,
  signal: SignalPayload,
): Promise<void> {
  if (gen !== generation || pc !== conn) return;
  // Drop signals belonging to a different server negotiation so a stale offer
  // or candidate from a previous connection can never stall a new negotiation.
  if (
    currentNegotiationId !== undefined &&
    signal.negotiationId !== undefined &&
    signal.negotiationId !== currentNegotiationId
  ) {
    return;
  }

  try {
    if (signal.type === 'offer') {
      const offerCollision = makingOffer || conn.signalingState !== 'stable';
      // Impolite peer (host) ignores colliding offers; polite peer (guest) yields.
      if (offerCollision && currentIsInitiator) {
        return;
      }

      if (offerCollision && conn.signalingState === 'have-local-offer') {
        pendingOfferId = null;
        try {
          await conn.setLocalDescription({ type: 'rollback' });
        } catch {
          // Some environments/mocks apply rollback implicitly during setRemoteDescription
        }
        if (gen !== generation || pc !== conn) return;
      }

      await conn.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      if (gen !== generation || pc !== conn) return;
      hasRemoteDescription = true;
      updateRemoteIceUfrag(signal.sdp);
      await flushPendingCandidates(conn, gen);
      if (gen !== generation || pc !== conn) return;

      const answer = await conn.createAnswer();
      if (gen !== generation || pc !== conn) return;
      await conn.setLocalDescription(answer);
      if (gen !== generation || pc !== conn) return;

      if (answer.sdp) {
        const answerNegId =
          signal.negotiationId !== undefined ? signal.negotiationId : currentNegotiationId;
        sendSignal(roomCode, {
          type: 'answer',
          sdp: answer.sdp,
          ...(signal.offerId ? { offerId: signal.offerId } : {}),
          ...(answerNegId !== undefined ? { negotiationId: answerNegId } : {}),
        } satisfies SignalPayload);
      }
    } else if (signal.type === 'answer') {
      if (conn.signalingState !== 'have-local-offer') {
        return;
      }
      // Require an exact match to an outstanding local offer, and clear pendingOfferId
      // only after setRemoteDescription succeeds so a rejected answer leaves the
      // offer eligible for a valid answer.
      if (pendingOfferId === null || signal.offerId !== pendingOfferId) {
        return;
      }
      const matchedOfferId = pendingOfferId;
      await conn.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      if (gen !== generation || pc !== conn) return;
      if (pendingOfferId === matchedOfferId) {
        pendingOfferId = null;
      }
      hasRemoteDescription = true;
      updateRemoteIceUfrag(signal.sdp);
      await flushPendingCandidates(conn, gen);
    } else if (signal.type === 'candidate') {
      if (
        signal.candidate.usernameFragment &&
        retiredRemoteIceUfrags.has(signal.candidate.usernameFragment)
      ) {
        return;
      }
      if (
        !hasRemoteDescription ||
        !conn.remoteDescription ||
        !candidateMatchesRemoteUfrag(signal.candidate)
      ) {
        queuePendingCandidate(signal.candidate);
        return;
      }
      try {
        await conn.addIceCandidate(signal.candidate);
      } catch (err) {
        console.warn('Failed to add ICE candidate:', err);
      }
    }
  } catch (err) {
    console.error('Error handling WebRTC signal:', err);
  }
}

function enqueueIncomingSignal(
  conn: RTCPeerConnection,
  gen: number,
  signal: SignalPayload,
): void {
  signalQueue = signalQueue.then(() => handleIncomingSignal(conn, gen, signal));
}

function decodeChannelData(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return null;
}

function isTransportHealthy(conn: RTCPeerConnection | null): boolean {
  if (!conn) return true;
  const ice = conn.iceConnectionState;
  const state = conn.connectionState;
  if (
    ice === 'disconnected' ||
    ice === 'failed' ||
    ice === 'closed' ||
    state === 'disconnected' ||
    state === 'failed' ||
    state === 'closed'
  ) {
    return false;
  }
  return true;
}

function handlePeerDisconnect(gen: number): void {
  if (gen !== generation) return;
  if (!hasEverConnected) {
    // Terminal failure during initial setup: tear down so the failed
    // RTCPeerConnection and signaling listener do not leak in the lobby.
    teardownConnection();
    generation += 1;
    statusHandler?.('disconnected');
    return;
  }
  clearTimers();
  peerConnected = false;
  emitStatus(gen, 'disconnected');
}

function attachDataChannel(channel: RTCDataChannel, gen: number): void {
  if (gen !== generation) return;
  // Detach any prior channel on this connection before attaching so a replaced
  // channel can never emit stale events.
  if (dataChannel && dataChannel !== channel) {
    dataChannel.onopen = null;
    dataChannel.onmessage = null;
    dataChannel.onclose = null;
    dataChannel.onerror = null;
    try {
      dataChannel.close();
    } catch {
      // Ignore close errors
    }
  }
  dataChannel = channel;

  const markConnected = () => {
    if (gen !== generation || dataChannel !== channel) return;
    if (!isTransportHealthy(pc)) return;
    clearTimers();
    peerConnected = true;
    hasEverConnected = true;
    emitStatus(gen, 'connected');
  };

  channel.onopen = () => {
    markConnected();
  };

  channel.onmessage = (event: MessageEvent) => {
    if (gen !== generation || dataChannel !== channel) return;
    const raw = decodeChannelData(event.data);
    if (raw === null) {
      console.warn('Ignoring unsupported data channel payload type');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPeerMessage(parsed)) {
        console.warn('Ignoring malformed peer message payload');
        return;
      }
      messageHandler?.(parsed);
    } catch (err) {
      console.warn('Failed to parse incoming peer message:', err);
    }
  };

  channel.onclose = () => {
    if (gen !== generation || dataChannel !== channel) return;
    handlePeerDisconnect(gen);
  };

  channel.onerror = (event: Event) => {
    if (gen !== generation || dataChannel !== channel) return;
    console.error('Data channel error:', event);
    if (channel.readyState === 'closed' || channel.readyState === 'closing') {
      handlePeerDisconnect(gen);
    }
  };

  if (channel.readyState === 'open') {
    markConnected();
  }
}

export function setMessageHandler(handler: MessageHandler | null): void {
  messageHandler = handler;
}

export function setStatusHandler(handler: StatusHandler | null): void {
  statusHandler = handler;
}

function initializePeerConnection(
  gen: number,
  isInitiator: boolean,
  iceServers: RTCIceServer[],
  iceDisconnectGraceMs: number,
): void {
  if (gen !== generation) return;

  let conn: RTCPeerConnection;
  try {
    conn = new RTCPeerConnection({ iceServers });
  } catch (err) {
    console.error('Failed to initialize peer connection:', err);
    if (gen === generation) {
      teardownConnection();
      generation += 1;
      statusHandler?.('disconnected');
    }
    return;
  }

  pc = conn;

  conn.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
    if (gen !== generation || pc !== conn) return;
    if (!event.candidate) return;
    const candidateInit =
      typeof event.candidate.toJSON === 'function'
        ? event.candidate.toJSON()
        : (event.candidate as unknown as RTCIceCandidateInit);
    sendSignal(roomCode, {
      type: 'candidate',
      candidate: candidateInit,
      ...(currentNegotiationId !== undefined
        ? { negotiationId: currentNegotiationId }
        : {}),
    } satisfies SignalPayload);
  };

  const handleTransportStateChange = () => {
    if (gen !== generation || pc !== conn) return;
    const iceState = conn.iceConnectionState;
    const connState = conn.connectionState;

    if (
      iceState === 'failed' ||
      iceState === 'closed' ||
      connState === 'failed' ||
      connState === 'closed'
    ) {
      handlePeerDisconnect(gen);
      return;
    }

    if (iceState === 'disconnected' || connState === 'disconnected') {
      if (iceDisconnectTimer === null) {
        iceDisconnectTimer = setTimeout(() => {
          iceDisconnectTimer = null;
          if (gen !== generation || pc !== conn) return;
          if (
            conn.iceConnectionState === 'connected' ||
            conn.iceConnectionState === 'completed' ||
            conn.connectionState === 'connected'
          ) {
            return;
          }
          peerConnected = false;
          emitStatus(gen, 'disconnected');
        }, iceDisconnectGraceMs);
      }
      return;
    }

    if (iceState === 'connected' || iceState === 'completed' || connState === 'connected') {
      if (iceDisconnectTimer !== null) {
        clearTimeout(iceDisconnectTimer);
        iceDisconnectTimer = null;
      }
      // If an ICE restart recovered an already-open data channel, restore connected status.
      if (!peerConnected && dataChannel && dataChannel.readyState === 'open') {
        clearTimers();
        peerConnected = true;
        emitStatus(gen, 'connected');
      }
    }
  };

  conn.oniceconnectionstatechange = handleTransportStateChange;
  conn.onconnectionstatechange = handleTransportStateChange;

  if (isInitiator) {
    const channel = conn.createDataChannel('belote', { ordered: true });
    attachDataChannel(channel, gen);
    void createAndSendOffer(conn, gen, false);
  } else {
    conn.ondatachannel = (event: RTCDataChannelEvent) => {
      if (gen !== generation || pc !== conn) return;
      const incoming = event.channel;
      // Accept only the single ordered 'belote' data channel; reject unexpected or extra channels.
      if (incoming.label !== 'belote' || incoming.ordered === false || dataChannel !== null) {
        try {
          incoming.close();
        } catch {
          // Ignore close errors
        }
        return;
      }
      attachDataChannel(incoming, gen);
    };
  }

  // Replay any valid signaling payloads received while ICE servers were loading
  const queued = pendingSignals.splice(0, pendingSignals.length);
  for (const signal of queued) {
    if (gen !== generation || pc !== conn) break;
    enqueueIncomingSignal(conn, gen, signal);
  }
}

export async function createPeer(
  isInitiator: boolean,
  code: string,
  options: CreatePeerOptions = {},
): Promise<void> {
  destroyPeer();

  const gen = generation;
  roomCode = code;
  currentIsInitiator = isInitiator;
  currentNegotiationId = options.negotiationId;
  pendingSignals = options.initialSignals ? [...options.initialSignals] : [];

  const setupTimeoutMs = options.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS;
  const iceDisconnectGraceMs = options.iceDisconnectGraceMs ?? DEFAULT_ICE_DISCONNECT_GRACE_MS;

  // Register the signal listener synchronously before awaiting ICE servers so
  // offers/candidates arriving while `/ice-servers` is in flight are buffered.
  const socket = getSocket();
  const normalizedPeerRoom = code.trim().toUpperCase();
  signalHandler = (data: { signal: unknown; roomCode?: unknown }) => {
    if (gen !== generation) return;
    if (
      typeof data?.roomCode === 'string' &&
      data.roomCode.trim().toUpperCase() !== normalizedPeerRoom
    ) {
      return;
    }
    if (!data || !isSignalPayload(data.signal)) {
      console.warn('Ignoring malformed WebRTC signal payload');
      return;
    }
    if (pc) {
      enqueueIncomingSignal(pc, gen, data.signal);
    } else {
      pendingSignals.push(data.signal);
    }
  };
  socket.on('signal', signalHandler);

  emitStatus(gen, 'connecting');
  if (gen !== generation) return;

  if (setupTimeoutMs > 0) {
    setupTimer = setTimeout(() => {
      if (gen !== generation) return;
      setupTimer = null;
      if (peerConnected) return;
      console.warn(`WebRTC connection setup timed out after ${setupTimeoutMs}ms`);
      teardownConnection();
      generation += 1;
      statusHandler?.('disconnected');
    }, setupTimeoutMs);
  }

  if (options.iceServers) {
    initializePeerConnection(gen, isInitiator, cloneIceServers(options.iceServers), iceDisconnectGraceMs);
    return;
  }

  const iceServers = await getIceServers();
  if (gen !== generation) return;
  initializePeerConnection(gen, isInitiator, iceServers, iceDisconnectGraceMs);
}

export function canRestartIce(): boolean {
  if (!pc) return false;
  if (pc.signalingState === 'closed' || pc.connectionState === 'closed') return false;
  if (!dataChannel) return false;
  return dataChannel.readyState !== 'closed' && dataChannel.readyState !== 'closing';
}

export async function restartIce(): Promise<boolean> {
  if (!canRestartIce() || !pc) return false;
  const conn = pc;
  const gen = generation;
  return createAndSendOffer(conn, gen, true);
}

export function sendPeerMessage(msg: PeerMessage): boolean {
  if (dataChannel && peerConnected && dataChannel.readyState === 'open') {
    try {
      dataChannel.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error('Failed to send peer message:', err);
      return false;
    }
  }
  return false;
}

export function destroyPeer(): void {
  generation += 1;
  teardownConnection();
}

export function isPeerConnected(): boolean {
  return peerConnected;
}

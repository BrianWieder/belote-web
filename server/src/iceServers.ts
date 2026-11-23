export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const DEFAULT_STUN_SERVERS: readonly IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

interface CachedIceServers {
  key: string;
  servers: IceServerConfig[];
  expiresAt: number;
}

let cache: CachedIceServers | null = null;

export function clearIceServersCache(): void {
  cache = null;
}

function cloneIceServers(servers: readonly IceServerConfig[]): IceServerConfig[] {
  return servers.map((server) => ({
    ...server,
    urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
  }));
}

export function buildStaticTurnServers(
  username: string,
  credential: string,
): IceServerConfig[] {
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

export function resolveMeteredDomain(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const rawDomain = env.METERED_DOMAIN?.trim();
  const rawAppName = env.METERED_APP_NAME?.trim();

  let candidate: string | null = null;
  let fromAppName = false;

  if (rawDomain) {
    candidate = rawDomain;
  } else if (rawAppName) {
    candidate = rawAppName;
    fromAppName = true;
  }

  if (!candidate) return null;

  candidate = candidate.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (fromAppName && !candidate.includes('.')) {
    candidate = `${candidate}.metered.live`;
  }

  if (!/^[a-z0-9.-]+$/i.test(candidate) || !candidate.includes('.')) {
    return null;
  }

  return candidate;
}

function isValidIceServer(entry: unknown): entry is IceServerConfig {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return false;
  }
  const candidate = entry as Record<string, unknown>;
  const validUrls =
    (typeof candidate.urls === 'string' && candidate.urls.length > 0) ||
    (Array.isArray(candidate.urls) &&
      candidate.urls.length > 0 &&
      candidate.urls.every((u) => typeof u === 'string' && u.length > 0));
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
  return true;
}

function normalizeIceServer(entry: IceServerConfig): IceServerConfig {
  const normalized: IceServerConfig = {
    urls: Array.isArray(entry.urls) ? [...entry.urls] : entry.urls,
  };
  if (entry.username !== undefined) normalized.username = entry.username;
  if (entry.credential !== undefined) normalized.credential = entry.credential;
  return normalized;
}

function mergeWithDefaultStun(fetched: IceServerConfig[]): IceServerConfig[] {
  const result = cloneIceServers(DEFAULT_STUN_SERVERS);
  const seenStun = new Set<string>(
    DEFAULT_STUN_SERVERS.map((s) =>
      typeof s.urls === 'string' ? s.urls : s.urls.join(','),
    ),
  );

  for (const entry of fetched) {
    const key =
      typeof entry.urls === 'string' ? entry.urls : entry.urls.join(',');
    if (!entry.username && !entry.credential && seenStun.has(key)) {
      continue;
    }
    result.push(normalizeIceServer(entry));
  }

  return result;
}

export interface GetIceServersOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export async function getIceServers(
  options: GetIceServersOptions = {},
): Promise<IceServerConfig[]> {
  const {
    env = process.env,
    fetchImpl = fetch,
    now = Date.now,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  } = options;

  const meteredDomain = resolveMeteredDomain(env);
  const meteredApiKey = env.METERED_API_KEY?.trim();

  if (meteredDomain && meteredApiKey) {
    const cacheKey = `${meteredDomain}:${meteredApiKey}`;
    const currentTime = now();
    if (cache && cache.key === cacheKey && currentTime < cache.expiresAt) {
      return cloneIceServers(cache.servers);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    try {
      const url = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`;
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Metered API responded with status ${response.status}`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Metered API response is not an array');
      }

      const validEntries = payload.filter(isValidIceServer);
      if (validEntries.length === 0) {
        throw new Error('Metered API returned no valid ICE servers');
      }

      const merged = mergeWithDefaultStun(validEntries);
      cache = {
        key: cacheKey,
        servers: merged,
        expiresAt: now() + cacheTtlMs,
      };
      return cloneIceServers(merged);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `Failed to fetch Metered TURN credentials from ${meteredDomain}: ${message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const turnUsername = env.TURN_USERNAME?.trim();
  const turnCredential = env.TURN_CREDENTIAL?.trim();
  if (turnUsername && turnCredential) {
    return [
      ...cloneIceServers(DEFAULT_STUN_SERVERS),
      ...buildStaticTurnServers(turnUsername, turnCredential),
    ];
  }

  return cloneIceServers(DEFAULT_STUN_SERVERS);
}

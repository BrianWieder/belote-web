import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearIceServersCache,
  DEFAULT_STUN_SERVERS,
  getIceServers,
  hasTurnServer,
} from '../peer';

describe('client ICE servers fetching and fallback', () => {
  beforeEach(() => {
    clearIceServersCache();
  });

  it('detects turn and turns URLs in string or array form', () => {
    expect(hasTurnServer([{ urls: 'stun:stun.l.google.com:19302' }])).toBe(false);
    expect(hasTurnServer([{ urls: 'turn:global.relay.metered.ca:80' }])).toBe(true);
    expect(
      hasTurnServer([{ urls: ['stun:a', 'turns:global.relay.metered.ca:443'] }]),
    ).toBe(true);
  });

  it('uses server-vended TURN servers, caches within TTL, and refreshes after expiry', async () => {
    let fetchCount = 0;
    let currentTime = 1_000;
    const mockFetch: typeof fetch = async (input) => {
      fetchCount++;
      expect(String(input)).toBe('https://signal.example.com/ice-servers');
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
              urls: 'turn:global.relay.metered.ca:443',
              username: `server-u-${fetchCount}`,
              credential: 'server-p',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const first = await getIceServers({
      serverUrl: 'https://signal.example.com/',
      fetchImpl: mockFetch,
      now: () => currentTime,
      cacheTtlMs: 60_000,
      legacyTurnUsername: 'legacy-u',
      legacyTurnCredential: 'legacy-p',
    });

    expect(fetchCount).toBe(1);
    expect(first).toHaveLength(2);
    expect(first[1].username).toBe('server-u-1');

    currentTime += 30_000;
    const second = await getIceServers({
      serverUrl: 'https://signal.example.com/',
      fetchImpl: mockFetch,
      now: () => currentTime,
      cacheTtlMs: 60_000,
    });
    expect(fetchCount).toBe(1);
    expect(second).toEqual(first);

    currentTime += 31_000;
    const third = await getIceServers({
      serverUrl: 'https://signal.example.com/',
      fetchImpl: mockFetch,
      now: () => currentTime,
      cacheTtlMs: 60_000,
    });
    expect(fetchCount).toBe(2);
    expect(third[1].username).toBe('server-u-2');
  });

  it('does not cache degraded STUN-only responses when no TURN servers are available', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          iceServers:
            calls === 1
              ? [{ urls: 'stun:stun.l.google.com:19302' }]
              : [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'turn:global.relay.metered.ca:443', username: 'u', credential: 'p' },
                ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const first = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(1);
    expect(hasTurnServer(first)).toBe(false);

    const second = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(2);
    expect(hasTurnServer(second)).toBe(true);
  });

  it('appends legacy client TURN credentials when server returns STUN-only', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const servers = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: 'legacy-u',
      legacyTurnCredential: 'legacy-p',
    });

    expect(servers).toHaveLength(5);
    expect(hasTurnServer(servers)).toBe(true);
    expect(servers[1].username).toBe('legacy-u');
    expect(servers[1].credential).toBe('legacy-p');
  });

  it('falls back to default STUN + legacy TURN when server request fails or times out', async () => {
    let calls = 0;
    const failingFetch: typeof fetch = async () => {
      calls++;
      throw new Error('Network unreachable');
    };

    const servers = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: failingFetch,
      legacyTurnUsername: 'legacy-u',
      legacyTurnCredential: 'legacy-p',
    });

    expect(calls).toBe(1);
    expect(servers).toHaveLength(DEFAULT_STUN_SERVERS.length + 4);
    expect(servers[DEFAULT_STUN_SERVERS.length].username).toBe('legacy-u');

    // Failed fetch should not be cached so a subsequent call can retry
    await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: failingFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(2);
  });

  it('falls back to default STUN-only when server fails and no legacy env vars exist', async () => {
    const slowFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const servers = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: slowFetch,
      timeoutMs: 20,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });

    expect(servers).toEqual([...DEFAULT_STUN_SERVERS]);
  });

  it('rejects entries containing malformed ICE URLs before TURN detection and caching', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: ['turn:relay.example:3478', 'not-an-ice-url'],
              username: 'u',
              credential: 'p',
            },
            { urls: 'turn:relay.example:notaport', username: 'u', credential: 'p' },
            { urls: 'turn:relay.example:99999', username: 'u', credential: 'p' },
            { urls: 'turn:relay.example:3478?transport=invalid', username: 'u', credential: 'p' },
            { urls: 'turn:relay.example:3478' },
            { urls: 'turn:relay.example:3478', username: 'u' },
            { urls: 'http://not-stun.example.com' },
            { urls: 'stun:stun.l.google.com:19302' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const first = await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(1);
    expect(first).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(hasTurnServer(first)).toBe(false);

    // Since the malformed TURN entry was rejected, only STUN remained and must not be cached
    await getIceServers({
      serverUrl: 'http://localhost:3001',
      fetchImpl: mockFetch,
      legacyTurnUsername: undefined,
      legacyTurnCredential: undefined,
    });
    expect(calls).toBe(2);
  });

  it('keys ICE cache and in-flight requests by endpoint URL', async () => {
    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const isA = url.startsWith('https://a.example.com');
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
              urls: 'turn:global.relay.metered.ca:443',
              username: isA ? 'user-a' : 'user-b',
              credential: 'pass',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const [a, b] = await Promise.all([
      getIceServers({ serverUrl: 'https://a.example.com', fetchImpl: mockFetch }),
      getIceServers({ serverUrl: 'https://b.example.com', fetchImpl: mockFetch }),
    ]);

    expect(requestedUrls).toEqual([
      'https://a.example.com/ice-servers',
      'https://b.example.com/ice-servers',
    ]);
    expect(a[1].username).toBe('user-a');
    expect(b[1].username).toBe('user-b');
  });
});

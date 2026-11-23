import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearIceServersCache,
  DEFAULT_STUN_SERVERS,
  getIceServers,
  resolveMeteredDomain,
} from '../iceServers.js';

describe('iceServers', () => {
  beforeEach(() => {
    clearIceServersCache();
  });

  describe('resolveMeteredDomain', () => {
    it('resolves METERED_DOMAIN and strips scheme/slashes', () => {
      assert.equal(
        resolveMeteredDomain({ METERED_DOMAIN: 'https://belote.metered.live/' }),
        'belote.metered.live',
      );
      assert.equal(
        resolveMeteredDomain({ METERED_DOMAIN: 'custom.example.com' }),
        'custom.example.com',
      );
    });

    it('expands bare METERED_APP_NAME to .metered.live', () => {
      assert.equal(
        resolveMeteredDomain({ METERED_APP_NAME: 'belote' }),
        'belote.metered.live',
      );
      assert.equal(
        resolveMeteredDomain({ METERED_APP_NAME: 'belote.metered.live' }),
        'belote.metered.live',
      );
    });

    it('returns null for missing or invalid domain values', () => {
      assert.equal(resolveMeteredDomain({}), null);
      assert.equal(resolveMeteredDomain({ METERED_DOMAIN: 'bad host/path' }), null);
    });
  });

  describe('getIceServers', () => {
    it('returns default STUN servers when no TURN env vars are configured', async () => {
      const servers = await getIceServers({ env: {} });
      assert.deepEqual(servers, [...DEFAULT_STUN_SERVERS]);
    });

    it('returns STUN + static TURN servers when TURN_USERNAME and TURN_CREDENTIAL are set', async () => {
      const servers = await getIceServers({
        env: {
          TURN_USERNAME: 'user-1',
          TURN_CREDENTIAL: 'pass-1',
        },
      });

      assert.equal(servers.length, DEFAULT_STUN_SERVERS.length + 4);
      assert.deepEqual(servers.slice(0, DEFAULT_STUN_SERVERS.length), [
        ...DEFAULT_STUN_SERVERS,
      ]);
      assert.equal(servers[3].urls, 'turn:global.relay.metered.ca:80');
      assert.equal(servers[3].username, 'user-1');
      assert.equal(servers[3].credential, 'pass-1');
      assert.equal(servers[6].urls, 'turns:global.relay.metered.ca:443?transport=tcp');
    });

    it('fetches ephemeral credentials from Metered API, merges STUN without duplicates, and caches within TTL', async () => {
      let fetchCalls = 0;
      let requestedUrl = '';
      let currentTime = 10_000;

      const mockFetch: typeof fetch = async (input) => {
        fetchCalls++;
        requestedUrl = String(input);
        return new Response(
          JSON.stringify([
            { urls: 'stun:stun.relay.metered.ca:80' },
            {
              urls: 'turn:global.relay.metered.ca:443',
              username: 'ephemeral-user',
              credential: 'ephemeral-pass',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const env = {
        METERED_APP_NAME: 'belote-app',
        METERED_API_KEY: 'secret-key',
      };

      const first = await getIceServers({
        env,
        fetchImpl: mockFetch,
        now: () => currentTime,
        cacheTtlMs: 60_000,
      });

      assert.equal(fetchCalls, 1);
      assert.equal(
        requestedUrl,
        'https://belote-app.metered.live/api/v1/turn/credentials?apiKey=secret-key',
      );
      // 3 default STUN (deduped stun.relay.metered.ca:80) + 1 TURN
      assert.equal(first.length, 4);
      assert.equal(first[3].username, 'ephemeral-user');

      // Mutating returned array should not poison cache
      first[0].urls = 'mutated';

      // Cached hit within TTL
      currentTime += 30_000;
      const second = await getIceServers({
        env,
        fetchImpl: mockFetch,
        now: () => currentTime,
        cacheTtlMs: 60_000,
      });
      assert.equal(fetchCalls, 1);
      assert.equal(second[0].urls, DEFAULT_STUN_SERVERS[0].urls);

      // Expired cache triggers fresh fetch
      currentTime += 31_000;
      await getIceServers({
        env,
        fetchImpl: mockFetch,
        now: () => currentTime,
        cacheTtlMs: 60_000,
      });
      assert.equal(fetchCalls, 2);
    });

    it('falls back to static TURN credentials if Metered API fails', async () => {
      const failingFetch: typeof fetch = async () =>
        new Response('Server Error', { status: 500 });

      const servers = await getIceServers({
        env: {
          METERED_DOMAIN: 'belote.metered.live',
          METERED_API_KEY: 'secret-key',
          TURN_USERNAME: 'fallback-user',
          TURN_CREDENTIAL: 'fallback-pass',
        },
        fetchImpl: failingFetch,
      });

      assert.equal(servers.length, DEFAULT_STUN_SERVERS.length + 4);
      assert.equal(servers[3].username, 'fallback-user');
    });

    it('falls back to STUN-only on Metered API timeout when no static TURN credentials exist', async () => {
      const slowFetch: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          const keepAlive = setInterval(() => {}, 1000);
          init?.signal?.addEventListener('abort', () => {
            clearInterval(keepAlive);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });

      const servers = await getIceServers({
        env: {
          METERED_DOMAIN: 'belote.metered.live',
          METERED_API_KEY: 'secret-key',
        },
        fetchImpl: slowFetch,
        timeoutMs: 25,
      });

      assert.deepEqual(servers, [...DEFAULT_STUN_SERVERS]);
    });
  });
});

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearRooms,
  cleanupExpiredRooms,
  createRoom,
  getRoom,
  getRoomCount,
  joinRoom,
  normalizeRoomCode,
  removePlayerFromRooms,
  ROOM_TTL_MS,
  stopRoomCleanup,
} from '../rooms.js';

describe('rooms', () => {
  beforeEach(() => {
    clearRooms();
  });

  after(() => {
    clearRooms();
    stopRoomCleanup();
  });

  describe('normalizeRoomCode', () => {
    it('trims and uppercases valid 4-char alphanumeric codes', () => {
      assert.equal(normalizeRoomCode('ab23'), 'AB23');
      assert.equal(normalizeRoomCode('  Xy9Z \n'), 'XY9Z');
    });

    it('rejects non-strings and malformed codes', () => {
      assert.equal(normalizeRoomCode(null), null);
      assert.equal(normalizeRoomCode(undefined), null);
      assert.equal(normalizeRoomCode(1234), null);
      assert.equal(normalizeRoomCode({}), null);
      assert.equal(normalizeRoomCode(['ABCD']), null);
      assert.equal(normalizeRoomCode(''), null);
      assert.equal(normalizeRoomCode('ABC'), null);
      assert.equal(normalizeRoomCode('ABCDE'), null);
      assert.equal(normalizeRoomCode('AB-D'), null);
      assert.equal(normalizeRoomCode('AB D'), null);
    });
  });

  describe('createRoom', () => {
    it('creates a room with a 4-char code and empty guest slot', () => {
      const room = createRoom('host-1');
      assert.ok(room);
      assert.match(room.code, /^[A-Z0-9]{4}$/);
      assert.equal(room.hostSocketId, 'host-1');
      assert.equal(room.guestSocketId, null);
      assert.equal(getRoomCount(), 1);
    });

    it('cleans up an existing room owned by the same host socket', () => {
      const first = createRoom('host-1', { codeGenerator: () => 'AAAA' });
      assert.ok(first);
      assert.equal(getRoomCount(), 1);

      const second = createRoom('host-1', { codeGenerator: () => 'BBBB' });
      assert.ok(second);
      assert.equal(getRoomCount(), 1);
      assert.equal(getRoom('AAAA'), null);
      assert.equal(getRoom('BBBB')?.hostSocketId, 'host-1');
    });

    it('enforces maxRooms capacity cap', () => {
      const r1 = createRoom('host-1', { maxRooms: 2, codeGenerator: () => 'AAA1' });
      const r2 = createRoom('host-2', { maxRooms: 2, codeGenerator: () => 'AAA2' });
      const r3 = createRoom('host-3', { maxRooms: 2, codeGenerator: () => 'AAA3' });

      assert.ok(r1);
      assert.ok(r2);
      assert.equal(r3, null);
      assert.equal(getRoomCount(), 2);

      // Existing host replacing their own room still succeeds at cap
      const replaced = createRoom('host-1', { maxRooms: 2, codeGenerator: () => 'AAA4' });
      assert.ok(replaced);
      assert.equal(replaced.code, 'AAA4');
      assert.equal(getRoomCount(), 2);
    });

    it('caps code generation retries instead of looping forever', () => {
      const r1 = createRoom('host-1', { codeGenerator: () => 'DUP1' });
      assert.ok(r1);

      let attempts = 0;
      const r2 = createRoom('host-2', {
        maxAttempts: 5,
        codeGenerator: () => {
          attempts++;
          return 'DUP1';
        },
      });

      assert.equal(r2, null);
      assert.equal(attempts, 5);
    });
  });

  describe('joinRoom', () => {
    it('allows a different socket to join with normalized code', () => {
      const created = createRoom('host-1', { codeGenerator: () => 'AB23' });
      assert.ok(created);

      const joined = joinRoom(' ab23 ', 'guest-1');
      assert.ok(joined);
      assert.equal(joined.code, 'AB23');
      assert.equal(joined.guestSocketId, 'guest-1');
    });

    it('prevents a host from joining their own room', () => {
      const created = createRoom('host-1', { codeGenerator: () => 'SELF' });
      assert.ok(created);

      const joined = joinRoom('SELF', 'host-1');
      assert.equal(joined, null);
      assert.equal(getRoom('SELF')?.guestSocketId, null);
    });

    it('rejects joining a full or missing room', () => {
      createRoom('host-1', { codeGenerator: () => 'FULL' });
      assert.ok(joinRoom('FULL', 'guest-1'));
      assert.equal(joinRoom('FULL', 'guest-2'), null);
      assert.equal(joinRoom('NONE', 'guest-2'), null);
      assert.equal(joinRoom('bad', 'guest-2'), null);
    });
  });

  describe('removePlayerFromRooms and cleanupExpiredRooms', () => {
    it('removes rooms containing the disconnected host or guest', () => {
      createRoom('host-1', { codeGenerator: () => 'RM01' });
      joinRoom('RM01', 'guest-1');
      createRoom('host-2', { codeGenerator: () => 'RM02' });

      const removed = removePlayerFromRooms('guest-1');
      assert.deepEqual(removed, ['RM01']);
      assert.equal(getRoom('RM01'), null);
      assert.ok(getRoom('RM02'));
    });

    it('cleans up expired rooms while keeping fresh rooms', () => {
      const start = 1_000_000;
      createRoom('host-old', { codeGenerator: () => 'OLD1', now: () => start });
      createRoom('host-new', {
        codeGenerator: () => 'NEW1',
        now: () => start + ROOM_TTL_MS - 1_000,
      });

      const removed = cleanupExpiredRooms(start + ROOM_TTL_MS + 1);
      assert.equal(removed, 1);
      assert.equal(getRoom('OLD1'), null);
      assert.ok(getRoom('NEW1'));
    });
  });
});

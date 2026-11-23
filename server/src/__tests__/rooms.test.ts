import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelPendingJoin,
  clearRooms,
  cleanupExpiredRooms,
  confirmGuestSeat,
  createRoom,
  disconnectPlayerFromRooms,
  getRoom,
  getRoomCount,
  joinRoom,
  leaveRoomWithToken,
  markNegotiationComplete,
  normalizeRoomCode,
  RECONNECT_GRACE_MS,
  rejoinRoom,
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
    it('creates a room with a 4-char code, host token, and empty guest slot', () => {
      const room = createRoom('host-1');
      assert.ok(room);
      assert.match(room.code, /^[A-Z0-9]{4}$/);
      assert.equal(room.hostSocketId, 'host-1');
      assert.equal(room.guestSocketId, null);
      assert.ok(room.hostToken.length > 0);
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

  describe('joinRoom, confirmGuestSeat, and cancelPendingJoin', () => {
    it('allows a different socket to join with normalized code and retries idempotently', () => {
      const created = createRoom('host-1', { codeGenerator: () => 'AB23' });
      assert.ok(created);

      const joined = joinRoom(' ab23 ', 'guest-1', Date.now(), 'attempt-1');
      assert.ok(joined);
      assert.equal(joined.code, 'AB23');
      assert.equal(joined.guestSocketId, 'guest-1');
      assert.equal(joined.hasStarted, false);
      const initialToken = joined.guestToken;
      assert.ok(initialToken);

      // Same guest retrying (e.g. after a client timeout) keeps the original token
      const retried = joinRoom('AB23', 'guest-1', Date.now(), 'attempt-2');
      assert.ok(retried);
      assert.equal(retried.guestToken, initialToken);
      assert.equal(retried.guestJoinAttemptId, 'attempt-2');
    });

    it('scopes cancelPendingJoin by attemptId and ignores confirmed seats', () => {
      createRoom('host-1', { codeGenerator: () => 'CNCL' });
      assert.ok(joinRoom('CNCL', 'guest-1', Date.now(), 'attempt-1'));
      assert.ok(joinRoom('CNCL', 'guest-1', Date.now(), 'attempt-2'));

      // Non-guest cannot cancel
      assert.equal(cancelPendingJoin('CNCL', 'intruder', 'attempt-2'), null);
      // Stale attemptId cannot cancel newer attempt
      assert.equal(cancelPendingJoin('CNCL', 'guest-1', 'attempt-1'), null);
      assert.equal(getRoom('CNCL')?.guestSocketId, 'guest-1');

      // Matching attemptId releases the provisional slot cleanly
      const cancelled = cancelPendingJoin('CNCL', 'guest-1', 'attempt-2');
      assert.deepEqual(cancelled, { code: 'CNCL', hostSocketId: 'host-1' });
      assert.equal(getRoom('CNCL')?.guestSocketId, null);
      assert.equal(getRoom('CNCL')?.hasStarted, false);

      // Code-only join stores null attemptId: scoped cancel is rejected, code-only cancel succeeds
      assert.ok(joinRoom('CNCL', 'guest-code-only', Date.now()));
      assert.equal(cancelPendingJoin('CNCL', 'guest-code-only', 'any-id'), null);
      assert.equal(getRoom('CNCL')?.guestSocketId, 'guest-code-only');
      assert.deepEqual(cancelPendingJoin('CNCL', 'guest-code-only'), {
        code: 'CNCL',
        hostSocketId: 'host-1',
      });

      // Confirmed seat cannot be cancelled by stale cancel-join, and confirmGuestSeat requires matching attemptId
      assert.ok(joinRoom('CNCL', 'guest-2', Date.now(), 'attempt-3'));
      assert.equal(confirmGuestSeat('CNCL', 'guest-2', 'attempt-stale'), false);
      assert.equal(getRoom('CNCL')?.guestConfirmed, false);
      assert.equal(confirmGuestSeat('CNCL', 'guest-2', 'attempt-3'), true);
      assert.equal(cancelPendingJoin('CNCL', 'guest-2', 'attempt-3'), null);
      assert.equal(getRoom('CNCL')?.guestSocketId, 'guest-2');

      // Pre-start guest leaveRoomWithToken releases only guest seat and preserves host room
      const guestToken = getRoom('CNCL')?.guestToken;
      assert.ok(guestToken);
      const guestPreStartLeave = leaveRoomWithToken('CNCL', 'guest', guestToken);
      assert.deepEqual(guestPreStartLeave, {
        code: 'CNCL',
        role: 'guest',
        preserved: false,
        provisionalCancelled: true,
        remainingSocketId: 'host-1',
      });
      assert.ok(getRoom('CNCL'));
      assert.equal(getRoom('CNCL')?.guestSocketId, null);
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

  describe('disconnectPlayerFromRooms, rejoinRoom, and cleanupExpiredRooms', () => {
    it('deletes unstarted lobby rooms immediately on host disconnect', () => {
      createRoom('host-1', { codeGenerator: () => 'LOB1' });
      const res = disconnectPlayerFromRooms('host-1', 1_000);
      assert.deepEqual(res, [
        { code: 'LOB1', role: 'host', preserved: false, remainingSocketId: null },
      ]);
      assert.equal(getRoom('LOB1'), null);
    });

    it('releases unstarted guest slot on disconnect even after confirmGuestSeat until setup completes', () => {
      const start = 10_000;
      createRoom('host-1', { codeGenerator: () => 'PROV', now: () => start });
      assert.ok(joinRoom('PROV', 'guest-1', start, 'attempt-1'));
      assert.equal(confirmGuestSeat('PROV', 'guest-1'), true);

      // Guest disconnects before initial WebRTC setup completes -> slot released, room stays open
      // Even a premature host peer-connected before guest receipt must NOT mark hasStarted
      assert.equal(markNegotiationComplete('PROV', 'host-1', 0), false);
      assert.equal(getRoom('PROV')?.hasStarted, false);

      const res = disconnectPlayerFromRooms('guest-1', start + 500);
      assert.deepEqual(res, [
        {
          code: 'PROV',
          role: 'guest',
          preserved: false,
          provisionalCancelled: true,
          remainingSocketId: 'host-1',
        },
      ]);
      assert.equal(getRoom('PROV')?.guestSocketId, null);
      assert.equal(getRoom('PROV')?.hasStarted, false);

      // Guest retries on a new socket and succeeds
      assert.ok(joinRoom('PROV', 'guest-2', start + 1_000, 'attempt-2'));
    });

    it('preserves confirmed active rooms during grace window and returns negotiationId on rejoin retry', () => {
      const start = 10_000;
      const room = createRoom('host-1', { codeGenerator: () => 'REC1', now: () => start });
      assert.ok(room);
      const joined = joinRoom('REC1', 'guest-1', start);
      assert.ok(joined?.guestToken);
      assert.equal(confirmGuestSeat('REC1', 'guest-1'), true);
      // Initial WebRTC setup completes -> room transitions to active (hasStarted = true)
      assert.equal(markNegotiationComplete('REC1', 'guest-1', 0), true);

      const disconnected = disconnectPlayerFromRooms('guest-1', start + 1_000);
      assert.deepEqual(disconnected, [
        { code: 'REC1', role: 'guest', preserved: true, remainingSocketId: 'host-1' },
      ]);
      assert.ok(getRoom('REC1'));

      // Wrong token is rejected
      const badToken = rejoinRoom('REC1', 'guest', 'wrong', 'guest-2', start + 2_000);
      assert.equal(badToken.ok, false);

      // Valid token within grace window starts negotiation #1
      const ok = rejoinRoom('REC1', 'guest', joined.guestToken, 'guest-2', start + 2_000);
      assert.equal(ok.ok, true);
      if (ok.ok) {
        assert.equal(ok.role, 'guest');
        assert.equal(ok.otherSocketId, 'host-1');
        assert.equal(ok.alreadyNegotiating, false);
        assert.equal(ok.negotiationId, 1);
        assert.equal(getRoom('REC1')?.guestSocketId, 'guest-2');
      }

      // Host retry within dedupe window returns same negotiationId and role so a missed ack can recover
      const hostRetry = rejoinRoom('REC1', 'host', room.hostToken, 'host-1', start + 2_500, {
        retry: true,
      });
      assert.equal(hostRetry.ok, true);
      if (hostRetry.ok) {
        assert.equal(hostRetry.role, 'host');
        assert.equal(hostRetry.alreadyNegotiating, true);
        assert.equal(hostRetry.negotiationId, 1);
      }

      // Guest retry recovering a missed ACK bumps negotiationId and triggers a fresh offer
      const guestRetry = rejoinRoom('REC1', 'guest', joined.guestToken, 'guest-2', start + 3_000, {
        retry: true,
      });
      assert.equal(guestRetry.ok, true);
      if (guestRetry.ok) {
        assert.equal(guestRetry.role, 'guest');
        assert.equal(guestRetry.alreadyNegotiating, false);
        assert.equal(guestRetry.negotiationId, 2);
      }

      // Stale negotiationId completion does NOT clear a newer active negotiation
      assert.equal(markNegotiationComplete('REC1', 'host-1', 1), true);
      assert.equal(getRoom('REC1')?.pendingNegotiationInitiator, 'guest');

      // Matching negotiationId completion clears the dedupe window so a new drop starts negotiation #3
      assert.equal(markNegotiationComplete('REC1', 'host-1', 2), true);
      const afterRecovery = rejoinRoom('REC1', 'host', room.hostToken, 'host-1', start + 3_500);
      assert.equal(afterRecovery.ok, true);
      if (afterRecovery.ok) {
        assert.equal(afterRecovery.alreadyNegotiating, false);
        assert.equal(afterRecovery.negotiationId, 3);
      }

      // Passive seat restoration while no negotiation is pending clears grace timer without triggering negotiation
      assert.equal(markNegotiationComplete('REC1', 'host-1', 3), true);
      disconnectPlayerFromRooms('host-1', start + 4_000);
      assert.equal(getRoom('REC1')?.hostSocketId, null);
      const passive = rejoinRoom('REC1', 'host', room.hostToken, 'host-3', start + 4_500, {
        passive: true,
      });
      assert.equal(passive.ok, true);
      if (passive.ok) {
        assert.equal(passive.alreadyNegotiating, true);
        assert.equal(passive.negotiationId, null);
        assert.equal(getRoom('REC1')?.hostSocketId, 'host-3');
        assert.equal(getRoom('REC1')?.hostDisconnectedAt, null);
      }

      // When one peer actively rejoins while the other seat is absent (peerPresent: false),
      // a subsequent passive rejoin by the opponent promotes to an active negotiation so the waiting peer wakes up
      disconnectPlayerFromRooms('host-3', start + 5_000);
      disconnectPlayerFromRooms('guest-2', start + 5_100);
      const waitingGuest = rejoinRoom('REC1', 'guest', joined.guestToken, 'guest-3', start + 5_200);
      assert.equal(waitingGuest.ok, true);
      if (waitingGuest.ok) {
        assert.equal(waitingGuest.otherSocketId, null);
      }
      const promotedPassiveHost = rejoinRoom('REC1', 'host', room.hostToken, 'host-4', start + 5_300, {
        passive: true,
      });
      assert.equal(promotedPassiveHost.ok, true);
      if (promotedPassiveHost.ok) {
        assert.equal(promotedPassiveHost.alreadyNegotiating, false);
        assert.equal(promotedPassiveHost.negotiationId, 4);
        assert.equal(promotedPassiveHost.otherSocketId, 'guest-3');
      }

      // If host drops signaling before sending the offer for negotiation #4 and passively
      // restores on a new socket, the unmatched pending negotiation promotes to #5 so guest does not hang
      disconnectPlayerFromRooms('host-4', start + 5_400);
      const promotedHostOwnPending = rejoinRoom(
        'REC1',
        'host',
        room.hostToken,
        'host-4b',
        start + 5_500,
        { passive: true },
      );
      assert.equal(promotedHostOwnPending.ok, true);
      if (promotedHostOwnPending.ok) {
        assert.equal(promotedHostOwnPending.alreadyNegotiating, false);
        assert.equal(promotedHostOwnPending.negotiationId, 5);
      }

      // A failed replacement peer on negotiation #5 bumps once to #6, while the other peer's
      // simultaneous retry for the same failedNegotiationId (5) is deduped onto #6
      const retryFailedPeer = rejoinRoom('REC1', 'host', room.hostToken, 'host-4b', start + 5_600, {
        retry: true,
        failedNegotiationId: 5,
      });
      assert.equal(retryFailedPeer.ok, true);
      if (retryFailedPeer.ok) {
        assert.equal(retryFailedPeer.alreadyNegotiating, false);
        assert.equal(retryFailedPeer.negotiationId, 6);
      }
      const secondPeerSameFailure = rejoinRoom(
        'REC1',
        'guest',
        joined.guestToken,
        'guest-3',
        start + 5_650,
        { retry: true, failedNegotiationId: 5 },
      );
      assert.equal(secondPeerSameFailure.ok, true);
      if (secondPeerSameFailure.ok) {
        assert.equal(secondPeerSameFailure.alreadyNegotiating, true);
        assert.equal(secondPeerSameFailure.negotiationId, 6);
      }

      // Even AFTER the 5-second dedupe window expires, a stale failure report for a
      // superseded negotiation (5) must NOT interrupt the current negotiation (6) on the same pair
      const lateStaleFailure = rejoinRoom(
        'REC1',
        'guest',
        joined.guestToken,
        'guest-3',
        start + 12_000,
        { retry: true, failedNegotiationId: 5 },
      );
      assert.equal(lateStaleFailure.ok, true);
      if (lateStaleFailure.ok) {
        assert.equal(lateStaleFailure.alreadyNegotiating, true);
        assert.equal(lateStaleFailure.negotiationId, 6);
      }

      // If the guest reconnects on a NEW socket pair while negotiation 6 is still pending,
      // mustNegotiate takes precedence over staleFailedNegotiation so a fresh negotiation (#7) starts
      const changedPairStaleFailure = rejoinRoom(
        'REC1',
        'guest',
        joined.guestToken,
        'guest-3b',
        start + 12_100,
        { retry: true, failedNegotiationId: 5 },
      );
      assert.equal(changedPairStaleFailure.ok, true);
      if (changedPairStaleFailure.ok) {
        assert.equal(changedPairStaleFailure.alreadyNegotiating, false);
        assert.equal(changedPairStaleFailure.negotiationId, 7);
      }

      // After negotiation #7 completes, an active rejoin from a NEW socket with a stale
      // failedNegotiationId must still start a fresh negotiation (#8) for the new pair
      assert.equal(markNegotiationComplete('REC1', 'host-4b', 7), true);
      assert.equal(getRoom('REC1')?.pendingNegotiationInitiator, null);
      assert.equal(getRoom('REC1')?.lastRenegotiatedPair, null);
      const completedThenSocketReplaced = rejoinRoom(
        'REC1',
        'guest',
        joined.guestToken,
        'guest-3c',
        start + 12_500,
        { retry: true, failedNegotiationId: 5 },
      );
      assert.equal(completedThenSocketReplaced.ok, true);
      if (completedThenSocketReplaced.ok) {
        assert.equal(completedThenSocketReplaced.alreadyNegotiating, false);
        assert.equal(completedThenSocketReplaced.negotiationId, 8);
      }

      // If host rejoins before guest's stale socket is cleared, guest passively restoring
      // on a new socket promotes to a fresh negotiation so host is not left unmatched
      assert.equal(markNegotiationComplete('REC1', 'host-4b', 8), true);
      const hostBeforeGuestClear = rejoinRoom('REC1', 'host', room.hostToken, 'host-5', start + 13_000);
      assert.equal(hostBeforeGuestClear.ok, true);
      const guestPassiveNewSocket = rejoinRoom(
        'REC1',
        'guest',
        joined.guestToken,
        'guest-4',
        start + 13_100,
        { passive: true },
      );
      assert.equal(guestPassiveNewSocket.ok, true);
      if (guestPassiveNewSocket.ok) {
        assert.equal(guestPassiveNewSocket.alreadyNegotiating, false);
        assert.equal(guestPassiveNewSocket.negotiationId, 10);
        assert.equal(guestPassiveNewSocket.otherSocketId, 'host-5');
      }

      // If guest's passive restore ACK was lost and guest retries passively on the same pair,
      // the server mints a fresh matching negotiation (#11) so host and guest stay aligned
      const guestPassiveRetry = rejoinRoom(
        'REC1',
        'guest',
        joined.guestToken,
        'guest-4',
        start + 13_150,
        { passive: true, retry: true },
      );
      assert.equal(guestPassiveRetry.ok, true);
      if (guestPassiveRetry.ok) {
        assert.equal(guestPassiveRetry.alreadyNegotiating, false);
        assert.equal(guestPassiveRetry.negotiationId, 11);
      }

      // Token-authenticated leave closes a reserved room even after socket disconnect
      const guestDisconnectAt = start + 13_200;
      disconnectPlayerFromRooms('guest-4', guestDisconnectAt);
      assert.equal(getRoom('REC1')?.guestSocketId, null);
      assert.equal(getRoom('REC1')?.guestDisconnectedAt, guestDisconnectAt);
      assert.equal(leaveRoomWithToken('REC1', 'guest', 'bad-token'), null);
      assert.ok(getRoom('REC1'));
      const closed = leaveRoomWithToken('REC1', 'guest', joined.guestToken);
      assert.deepEqual(closed, {
        code: 'REC1',
        role: 'guest',
        preserved: false,
        remainingSocketId: 'host-5',
      });
      assert.equal(getRoom('REC1'), null);
    });

    it('removes rooms immediately on explicit removePlayerFromRooms', () => {
      createRoom('host-1', { codeGenerator: () => 'RM01' });
      joinRoom('RM01', 'guest-1');
      createRoom('host-2', { codeGenerator: () => 'RM02' });

      const removed = removePlayerFromRooms('guest-1');
      assert.deepEqual(removed, [
        { code: 'RM01', role: 'guest', preserved: false, remainingSocketId: 'host-1' },
      ]);
      assert.equal(getRoom('RM01'), null);
      assert.ok(getRoom('RM02'));
    });

    it('cleans up TTL-expired and grace-expired rooms while keeping fresh rooms', () => {
      const start = 1_000_000;
      createRoom('host-old', { codeGenerator: () => 'OLD1', now: () => start });
      createRoom('host-grace', { codeGenerator: () => 'GRC1', now: () => start + ROOM_TTL_MS - 1_000 });
      joinRoom('GRC1', 'guest-grace', start + ROOM_TTL_MS - 1_000);
      confirmGuestSeat('GRC1', 'guest-grace');
      markNegotiationComplete('GRC1', 'guest-grace', 0);
      disconnectPlayerFromRooms('guest-grace', start + ROOM_TTL_MS - 1_000);

      // Control room: older than RECONNECT_GRACE_MS, but guest disconnected inside the grace window
      const recentDisconnectAt = start + ROOM_TTL_MS + 10_000;
      assert.ok(
        createRoom('host-recent', {
          codeGenerator: () => 'RCT1',
          now: () => start + RECONNECT_GRACE_MS + 2_000,
        }),
      );
      assert.ok(joinRoom('RCT1', 'guest-recent', recentDisconnectAt));
      assert.equal(confirmGuestSeat('RCT1', 'guest-recent'), true);
      assert.equal(markNegotiationComplete('RCT1', 'guest-recent', 0), true);
      disconnectPlayerFromRooms('guest-recent', recentDisconnectAt);
      assert.equal(getRoom('RCT1')?.hasStarted, true);
      assert.equal(getRoom('RCT1')?.guestSocketId, null);
      assert.equal(getRoom('RCT1')?.guestDisconnectedAt, recentDisconnectAt);

      createRoom('host-new', {
        codeGenerator: () => 'NEW1',
        now: () => start + ROOM_TTL_MS + RECONNECT_GRACE_MS - 1_000,
      });

      const removed = cleanupExpiredRooms(start + ROOM_TTL_MS + RECONNECT_GRACE_MS + 1);
      assert.equal(removed, 2);
      assert.equal(getRoom('OLD1'), null);
      assert.equal(getRoom('GRC1'), null);
      assert.ok(getRoom('RCT1'));
      assert.ok(getRoom('NEW1'));
    });
  });
});

import { useEffect, useCallback, useRef } from 'react';
import {
  connectSignaling,
  createRoom as createSignalingRoom,
  joinRoom as joinSignalingRoom,
  rejoinRoom as rejoinSignalingRoom,
  confirmPeerConnected,
  notifyPeerConnected,
  leaveRoom as leaveSignalingRoom,
  isSignalingConnected,
  disconnectSignaling,
  getSocket,
} from '../networking/signaling';
import {
  createPeer,
  getIceServers,
  isSignalPayload,
  setMessageHandler,
  setStatusHandler,
  sendPeerMessage,
  destroyPeer,
  isPeerConnected,
  canRestartIce,
  restartIce,
} from '../networking/peer';
import { useGameStore } from '../store/gameStore';
import type { PeerMessage, SignalPayload } from '../networking/peer';
import type { GameState } from '../game/types';

const RECONNECT_TIMEOUT_MS = 18_000;
const ICE_RESTART_FALLBACK_MS = 4_500;
const SIGNALING_RECONNECT_TIMEOUT_MS = 8_000;
const SIGNALING_RETRY_DELAY_MS = 1_000;
const PASSIVE_RESTORE_RETRY_DELAY_MS = 2_000;
const MAX_PASSIVE_RESTORE_ATTEMPTS = 10;
const MAX_QUEUED_GUEST_MESSAGES = 64;
const MAX_QUEUED_GUEST_BYTES = 64 * 1024;
const MAX_PENDING_FUTURE_SIGNALS = 64;
const MAX_PENDING_FUTURE_SIGNAL_BYTES = 128 * 1024;

export function usePeer() {
  const setConnectionStatus = useGameStore((s) => s.setConnectionStatus);
  const setConnectionError = useGameStore((s) => s.setConnectionError);
  const setRoomCode = useGameStore((s) => s.setRoomCode);
  const setReconnectToken = useGameStore((s) => s.setReconnectToken);
  const setIsHost = useGameStore((s) => s.setIsHost);
  const setLocalPlayer = useGameStore((s) => s.setLocalPlayer);
  const setPendingResumeState = useGameStore((s) => s.setPendingResumeState);
  const initGame = useGameStore((s) => s.initGame);
  const receiveResumeGame = useGameStore((s) => s.receiveResumeGame);
  const receiveAction = useGameStore((s) => s.receiveAction);
  const receiveNextRound = useGameStore((s) => s.receiveNextRound);
  const receiveRoundReady = useGameStore((s) => s.receiveRoundReady);
  const receiveRematchReady = useGameStore((s) => s.receiveRematchReady);
  const receiveRematchStart = useGameStore((s) => s.receiveRematchStart);
  const sendFullState = useGameStore((s) => s.sendFullState);
  const receiveGameState = useGameStore((s) => s.receiveGameState);

  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalingRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passiveRestoreRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestReconcileCancelRef = useRef<(() => void) | null>(null);
  const passiveRestoreAttemptsRef = useRef(0);
  const reconnectingRef = useRef(false);
  const reconnectAttemptIdRef = useRef(0);
  const reconnectDeadlineRef = useRef(0);
  const activeRejoinInFlightRef = useRef(false);
  const activeRejoinCallIdRef = useRef(0);
  const pendingRejoinRequestsRef = useRef(0);
  const pendingScheduledRetryRef = useRef<{
    isRetry: boolean;
    failedNegotiationId?: number;
    armedNegotiationId: number;
  } | null>(null);
  const deferredSignalingRetryRef = useRef<{
    attemptId: number;
    isRetry: boolean;
    failedNegotiationId?: number;
    armedNegotiationId: number;
  } | null>(null);
  // Incremented only when the session itself ends (new room, join, cancel, unmount),
  // NOT when a reconnect attempt clears upon channel recovery.
  const sessionIdRef = useRef(0);
  // Tracks the latest server renegotiation ID that this client has already started.
  const startedNegotiationIdRef = useRef<number | null>(null);
  // Tracks the negotiation ID associated with the current peer connection (0 for initial setup).
  const activeNegotiationIdRef = useRef<number>(0);
  // Tracks the highest negotiation ID that has actually connected so late rejoin ACKs
  // for an already-completed negotiation can never tear down an open connection.
  const completedNegotiationIdRef = useRef<number | null>(null);
  // Preserves the host's initial resume snapshot until a guest joins and starts playing,
  // so a pre-start peer-join-cancelled can return the host to the lobby without losing it.
  const provisionalInitialResumeRef = useRef<GameState | null>(null);
  // Tracks an in-flight guest initial start confirmation so gameplay messages,
  // peer-reconnected notifications, and newer-negotiation signals are retained and replayed.
  const pendingInitialGuestConfirmRef = useRef(false);
  const queuedGuestMessagesRef = useRef<PeerMessage[]>([]);
  const queuedGuestBytesRef = useRef(0);
  const queuedGuestOverflowedRef = useRef(false);
  const pendingPeerReconnectedRef = useRef<{
    negotiationId: number | null;
    initiator: boolean;
  } | null>(null);
  const pendingFutureSignalsRef = useRef<
    Array<{ signal: SignalPayload; bytes: number; roomCode: string | null }>
  >([]);
  const pendingFutureSignalBytesRef = useRef(0);
  // True while joinGame is awaiting join-room before the initial guest peer is installed,
  // so negotiation-0 offers arriving in the same transport batch as the join ACK are buffered.
  const awaitingInitialJoinPeerRef = useRef(false);
  // Room code currently being joined before store.roomCode is set, used to scope
  // peer-disconnected closures and buffered signals strictly to the target room.
  const pendingJoinRoomCodeRef = useRef<string | null>(null);
  // Retains staged guest opening state and reconnect credentials when reconciliation
  // expires without definitive server rejection, enabling an explicit token-based retry.
  const unconfirmedGuestStartRef = useRef<{
    roomCode: string;
    reconnectToken: string;
    applyInitialState: () => void;
    bufferedMessages: PeerMessage[];
    overflowed: boolean;
  } | null>(null);
  const resumeUnconfirmedStartRef = useRef<
    ((
      saved: {
        roomCode: string;
        reconnectToken: string;
        applyInitialState: () => void;
        bufferedMessages: PeerMessage[];
        overflowed: boolean;
      },
      rejoinResult: {
        role?: 'host' | 'guest';
        peerPresent?: boolean;
        negotiationId?: number;
      },
    ) => void) | null
  >(null);

  const consumePendingFutureSignals = useCallback(
    (negotiationId: number, targetRoomCode?: string | null): SignalPayload[] => {
      const normalizedTargetRoom = targetRoomCode?.trim().toUpperCase() ?? null;
      const matching: SignalPayload[] = [];
      const remaining: Array<{ signal: SignalPayload; bytes: number; roomCode: string | null }> =
        [];
      let remainingBytes = 0;
      for (const entry of pendingFutureSignalsRef.current) {
        if (
          entry.roomCode !== null &&
          normalizedTargetRoom !== null &&
          entry.roomCode !== normalizedTargetRoom
        ) {
          // Drop buffered signals belonging to a different room.
          continue;
        }
        const entryNegId = entry.signal.negotiationId;
        if (entryNegId === negotiationId || (negotiationId === 0 && entryNegId === undefined)) {
          matching.push(entry.signal);
        } else if (entryNegId !== undefined && entryNegId > negotiationId) {
          remaining.push(entry);
          remainingBytes += entry.bytes;
        }
      }
      pendingFutureSignalsRef.current = remaining;
      pendingFutureSignalBytesRef.current = remainingBytes;
      return matching;
    },
    [],
  );

  const clearGuestConfirmationState = useCallback(() => {
    awaitingInitialJoinPeerRef.current = false;
    pendingJoinRoomCodeRef.current = null;
    pendingInitialGuestConfirmRef.current = false;
    queuedGuestMessagesRef.current = [];
    queuedGuestBytesRef.current = 0;
    queuedGuestOverflowedRef.current = false;
    pendingPeerReconnectedRef.current = null;
    pendingFutureSignalsRef.current = [];
    pendingFutureSignalBytesRef.current = 0;
    if (guestReconcileTimerRef.current !== null) {
      clearTimeout(guestReconcileTimerRef.current);
      guestReconcileTimerRef.current = null;
    }
    const cancelWait = guestReconcileCancelRef.current;
    guestReconcileCancelRef.current = null;
    cancelWait?.();
  }, []);

  const clearReconnectState = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (iceFallbackTimerRef.current !== null) {
      clearTimeout(iceFallbackTimerRef.current);
      iceFallbackTimerRef.current = null;
    }
    if (signalingRetryTimerRef.current !== null) {
      clearTimeout(signalingRetryTimerRef.current);
      signalingRetryTimerRef.current = null;
    }
    if (passiveRestoreRetryTimerRef.current !== null) {
      clearTimeout(passiveRestoreRetryTimerRef.current);
      passiveRestoreRetryTimerRef.current = null;
    }
    passiveRestoreAttemptsRef.current = 0;
    reconnectingRef.current = false;
    reconnectDeadlineRef.current = 0;
    reconnectAttemptIdRef.current += 1;
    activeRejoinInFlightRef.current = false;
    activeRejoinCallIdRef.current += 1;
    pendingScheduledRetryRef.current = null;
    deferredSignalingRetryRef.current = null;
  }, []);

  useEffect(() => {
    const failReconnection = (attemptId: number) => {
      if (reconnectAttemptIdRef.current !== attemptId) return;
      clearReconnectState();
      pendingRejoinRequestsRef.current = 0;
      pendingFutureSignalsRef.current = [];
      pendingFutureSignalBytesRef.current = 0;
      startedNegotiationIdRef.current = null;
      destroyPeer();
      setConnectionStatus('disconnected');
    };

    const ensureReconnectDeadline = (): number => {
      if (reconnectingRef.current && reconnectTimeoutRef.current !== null) {
        return reconnectAttemptIdRef.current;
      }
      reconnectingRef.current = true;
      const attemptId = ++reconnectAttemptIdRef.current;
      reconnectDeadlineRef.current = performance.now() + RECONNECT_TIMEOUT_MS;
      setConnectionStatus('reconnecting');
      reconnectTimeoutRef.current = setTimeout(() => {
        failReconnection(attemptId);
      }, RECONNECT_TIMEOUT_MS);
      return attemptId;
    };

    const scheduleSignalingRetry = (
      attemptId: number,
      isRetry: boolean,
      failedNegotiationId?: number,
    ) => {
      if (reconnectAttemptIdRef.current !== attemptId || isPeerConnected()) return;
      const remainingMs = reconnectDeadlineRef.current - performance.now();
      if (remainingMs <= 250) {
        // Deadline timer will finish failing reconnection shortly
        return;
      }
      if (signalingRetryTimerRef.current !== null) {
        clearTimeout(signalingRetryTimerRef.current);
      }
      // Never discard a previously armed retry flag or failedNegotiationId for the same
      // negotiation when replacing a retry timer.
      const armedNegotiationId = activeNegotiationIdRef.current;
      const sameScheduled =
        pendingScheduledRetryRef.current?.armedNegotiationId === armedNegotiationId
          ? pendingScheduledRetryRef.current
          : null;
      const sameDeferred =
        deferredSignalingRetryRef.current?.armedNegotiationId === armedNegotiationId
          ? deferredSignalingRetryRef.current
          : null;
      const effectiveIsRetry =
        isRetry || (sameScheduled?.isRetry ?? false) || (sameDeferred?.isRetry ?? false);
      const effectiveFailedId =
        failedNegotiationId ??
        sameScheduled?.failedNegotiationId ??
        sameDeferred?.failedNegotiationId;
      pendingScheduledRetryRef.current = {
        isRetry: effectiveIsRetry,
        failedNegotiationId: effectiveFailedId,
        armedNegotiationId,
      };
      const delay = Math.min(SIGNALING_RETRY_DELAY_MS, Math.max(100, remainingMs - 200));
      signalingRetryTimerRef.current = setTimeout(() => {
        signalingRetryTimerRef.current = null;
        const scheduled = pendingScheduledRetryRef.current;
        pendingScheduledRetryRef.current = null;
        const retryToSend = effectiveIsRetry || (scheduled?.isRetry ?? false);
        const failedIdToSend = effectiveFailedId ?? scheduled?.failedNegotiationId;
        if (
          reconnectAttemptIdRef.current !== attemptId ||
          activeNegotiationIdRef.current !== armedNegotiationId ||
          isPeerConnected()
        ) {
          return;
        }
        if (activeRejoinInFlightRef.current) {
          // Defer rather than duplicate or drop while a rejoin for this attempt/negotiation is in flight.
          deferredSignalingRetryRef.current = {
            attemptId,
            isRetry: retryToSend,
            failedNegotiationId:
              failedIdToSend ?? deferredSignalingRetryRef.current?.failedNegotiationId,
            armedNegotiationId,
          };
          return;
        }
        void escalateToSignalingRejoin(attemptId, retryToSend, failedIdToSend);
      }, delay);
    };

    const escalateToSignalingRejoin = async (
      attemptId: number,
      isRetry = false,
      failedNegotiationId?: number,
    ) => {
      if (reconnectAttemptIdRef.current !== attemptId) return;

      const { roomCode, reconnectToken, isHost, gameState } = useGameStore.getState();
      if (!gameState || !roomCode || !reconnectToken) {
        failReconnection(attemptId);
        return;
      }

      const remainingBeforeConnect = reconnectDeadlineRef.current - performance.now();
      if (remainingBeforeConnect <= 0) {
        failReconnection(attemptId);
        return;
      }

      const sessionId = sessionIdRef.current;
      const startingNegotiationId = activeNegotiationIdRef.current;
      const callId = ++activeRejoinCallIdRef.current;
      activeRejoinInFlightRef.current = true;

      try {
        try {
          if (!isSignalingConnected()) {
            await connectSignaling(
              Math.min(SIGNALING_RECONNECT_TIMEOUT_MS, remainingBeforeConnect),
            );
          }
        } catch {
          if (activeNegotiationIdRef.current !== startingNegotiationId) return;
          // Transient signaling failure — keep retrying until the reconnect deadline expires
          scheduleSignalingRetry(attemptId, isRetry, failedNegotiationId);
          return;
        }

        if (
          reconnectAttemptIdRef.current !== attemptId ||
          activeNegotiationIdRef.current !== startingNegotiationId ||
          isPeerConnected()
        ) {
          return;
        }

        const remainingBeforeRejoin = reconnectDeadlineRef.current - performance.now();
        if (remainingBeforeRejoin <= 0) {
          failReconnection(attemptId);
          return;
        }

        let rejoinTracked = false;
        try {
          const role = isHost ? 'host' : 'guest';
          pendingRejoinRequestsRef.current += 1;
          rejoinTracked = true;
          const result = await rejoinSignalingRoom(
            roomCode,
            role,
            reconnectToken,
            Math.min(SIGNALING_RECONNECT_TIMEOUT_MS, remainingBeforeRejoin),
            {
              retry: isRetry,
              ...(failedNegotiationId !== undefined ? { failedNegotiationId } : {}),
            },
          );

          const latest = useGameStore.getState();
          if (
            sessionIdRef.current !== sessionId ||
            !latest.gameState ||
            latest.roomCode !== roomCode ||
            latest.connectionStatus === 'disconnected'
          ) {
            return;
          }

          if (!result.success) {
            // A provisional host rejoin can reach the server before the guest's
            // `peer-connected` confirmation commits `hasStarted`; keep retrying
            // within the existing deadline instead of terminating recovery early.
            if (isHost && result.error === 'Game has not started') {
              if (activeNegotiationIdRef.current === startingNegotiationId) {
                scheduleSignalingRetry(attemptId, true, failedNegotiationId);
              }
              return;
            }
            // Server-side terminal rejection (invalid token, expired/missing room)
            failReconnection(attemptId);
            return;
          }

          if (result.peerPresent) {
            const negotiationId = result.negotiationId ?? null;
            // Always ignore acknowledgements for negotiations older than our active one.
            if (negotiationId !== null && negotiationId < activeNegotiationIdRef.current) {
              return;
            }
            // Ignore late acknowledgements for an already-completed negotiation when connected.
            // If that completed negotiation's channel has since closed during active recovery,
            // schedule a retry with failedNegotiationId so the server mints a fresh negotiation.
            if (
              negotiationId !== null &&
              completedNegotiationIdRef.current !== null &&
              negotiationId <= completedNegotiationIdRef.current
            ) {
              if (
                reconnectAttemptIdRef.current === attemptId &&
                !isPeerConnected() &&
                negotiationId === completedNegotiationIdRef.current
              ) {
                scheduleSignalingRetry(attemptId, true, negotiationId);
              }
              return;
            }
            const alreadyStartedThisNegotiation =
              negotiationId !== null &&
              startedNegotiationIdRef.current === negotiationId;

            // Start our side whenever this is a new negotiation (!alreadyNegotiating)
            // OR a retry recovering a missed ack for a negotiation we never started locally.
            if (
              !alreadyStartedThisNegotiation &&
              (!result.alreadyNegotiating || negotiationId !== null)
            ) {
              // The reconnect deadline is terminal; do not start a replacement after it.
              if (reconnectingRef.current && performance.now() >= reconnectDeadlineRef.current) return;
              if (negotiationId !== null) {
                startedNegotiationIdRef.current = negotiationId;
                activeNegotiationIdRef.current = negotiationId;
              }
              const initiator = result.role ? result.role === 'host' : isHost;
              const initialSignals = consumePendingFutureSignals(
                activeNegotiationIdRef.current,
                roomCode,
              );
              ensureReconnectDeadline();
              void createPeer(initiator, roomCode, {
                negotiationId: activeNegotiationIdRef.current,
                ...(initialSignals.length > 0 ? { initialSignals } : {}),
              });
              return;
            }
          }

          if (reconnectAttemptIdRef.current !== attemptId || isPeerConnected()) return;
        } catch {
          if (activeNegotiationIdRef.current !== startingNegotiationId) return;
          // Transient signaling disconnect or request timeout — mark subsequent
          // attempts as retries so the server can recover a missed guest ACK.
          scheduleSignalingRetry(attemptId, true, failedNegotiationId);
        } finally {
          if (rejoinTracked && sessionIdRef.current === sessionId) {
            pendingRejoinRequestsRef.current = Math.max(0, pendingRejoinRequestsRef.current - 1);
          }
        }
      } finally {
        if (activeRejoinCallIdRef.current === callId) {
          activeRejoinInFlightRef.current = false;
          const deferred = deferredSignalingRetryRef.current;
          if (deferred) {
            deferredSignalingRetryRef.current = null;
            if (
              deferred.attemptId === reconnectAttemptIdRef.current &&
              deferred.armedNegotiationId === activeNegotiationIdRef.current &&
              !isPeerConnected()
            ) {
              void escalateToSignalingRejoin(
                deferred.attemptId,
                deferred.isRetry,
                deferred.failedNegotiationId,
              );
            }
          }
        }
      }
    };

    const startReconnection = () => {
      if (reconnectingRef.current) return;
      if (passiveRestoreRetryTimerRef.current !== null) {
        clearTimeout(passiveRestoreRetryTimerRef.current);
        passiveRestoreRetryTimerRef.current = null;
      }
      passiveRestoreAttemptsRef.current = 0;

      const { roomCode, reconnectToken, isHost } = useGameStore.getState();
      if (!roomCode || !reconnectToken) {
        setConnectionStatus('disconnected');
        return;
      }

      const attemptId = ensureReconnectDeadline();

      if (isSignalingConnected() && canRestartIce()) {
        if (isHost) {
          void restartIce().then((started) => {
            if (
              !started &&
              iceFallbackTimerRef.current !== null &&
              reconnectAttemptIdRef.current === attemptId &&
              !isPeerConnected()
            ) {
              clearTimeout(iceFallbackTimerRef.current);
              iceFallbackTimerRef.current = null;
              void escalateToSignalingRejoin(attemptId, false);
            }
          });
        }

        iceFallbackTimerRef.current = setTimeout(() => {
          iceFallbackTimerRef.current = null;
          if (reconnectAttemptIdRef.current !== attemptId || isPeerConnected()) return;
          void escalateToSignalingRejoin(attemptId, false);
        }, ICE_RESTART_FALLBACK_MS);
      } else {
        void escalateToSignalingRejoin(attemptId, false);
      }
    };

    const dispatchGameplayMessage = (msg: PeerMessage) => {
      switch (msg.type) {
        case 'game-action':
          receiveAction(msg.action, msg.seq);
          break;
        case 'new-round':
          receiveNextRound(msg.seq);
          break;
        case 'round-ready':
          receiveRoundReady(msg.round);
          break;
        case 'rematch-ready':
          receiveRematchReady();
          break;
        case 'rematch-start':
          receiveRematchStart(msg.seed, msg.dealer);
          break;
        case 'resync-request':
          sendFullState();
          break;
        case 'game-state':
          receiveGameState(msg.state);
          break;
      }
    };

    resumeUnconfirmedStartRef.current = (saved, rejoinResult) => {
      const retainedReconnect = pendingPeerReconnectedRef.current;
      pendingPeerReconnectedRef.current = null;
      unconfirmedGuestStartRef.current = null;
      saved.applyInitialState();
      if (!saved.overflowed) {
        for (const bufferedMsg of saved.bufferedMessages) {
          dispatchGameplayMessage(bufferedMsg);
        }
      }
      if (!useGameStore.getState().gameState) return;
      setConnectionError(null);
      ensureReconnectDeadline();

      const ackTarget = rejoinResult.peerPresent
        ? {
            negotiationId: rejoinResult.negotiationId ?? null,
            initiator: rejoinResult.role ? rejoinResult.role === 'host' : false,
          }
        : null;
      let targetNegotiation: { negotiationId: number | null; initiator: boolean } | null = null;
      if (ackTarget && retainedReconnect) {
        if (
          retainedReconnect.negotiationId !== null &&
          (ackTarget.negotiationId === null ||
            retainedReconnect.negotiationId > ackTarget.negotiationId)
        ) {
          targetNegotiation = retainedReconnect;
        } else {
          targetNegotiation = ackTarget;
        }
      } else if (ackTarget) {
        targetNegotiation = ackTarget;
      } else if (retainedReconnect) {
        targetNegotiation = retainedReconnect;
      }

      if (targetNegotiation) {
        if (targetNegotiation.negotiationId !== null) {
          startedNegotiationIdRef.current = targetNegotiation.negotiationId;
          activeNegotiationIdRef.current = targetNegotiation.negotiationId;
        }
        const initialSignals = consumePendingFutureSignals(
          activeNegotiationIdRef.current,
          saved.roomCode,
        );
        void createPeer(targetNegotiation.initiator, saved.roomCode, {
          negotiationId: activeNegotiationIdRef.current,
          ...(initialSignals.length > 0 ? { initialSignals } : {}),
        });
      }
    };

    const handleGuestInitialState = (applyInitialState: () => void) => {
      const { roomCode, reconnectToken, isHost, gameState } = useGameStore.getState();
      if (isHost || gameState || pendingInitialGuestConfirmRef.current) return;
      const sessionId = sessionIdRef.current;
      const negId = activeNegotiationIdRef.current;
      unconfirmedGuestStartRef.current = null;
      pendingInitialGuestConfirmRef.current = true;
      queuedGuestMessagesRef.current = [];
      queuedGuestBytesRef.current = 0;
      queuedGuestOverflowedRef.current = false;
      pendingPeerReconnectedRef.current = null;
      pendingFutureSignalsRef.current = [];
      pendingFutureSignalBytesRef.current = 0;

      const isCurrentConfirmation = () => {
        const latest = useGameStore.getState();
        return (
          sessionIdRef.current === sessionId &&
          latest.roomCode === roomCode &&
          !latest.gameState &&
          pendingInitialGuestConfirmRef.current
        );
      };

      const finalizeConfirmed = (
        rejoinPromotion?: { negotiationId: number; initiator: boolean },
      ) => {
        // Never mutate guest confirmation state if a newer session owns it.
        if (!isCurrentConfirmation()) return;

        pendingInitialGuestConfirmRef.current = false;
        const buffered = queuedGuestMessagesRef.current.splice(0);
        const didOverflow = queuedGuestOverflowedRef.current;
        queuedGuestBytesRef.current = 0;
        queuedGuestOverflowedRef.current = false;
        const retainedReconnect = pendingPeerReconnectedRef.current;
        pendingPeerReconnectedRef.current = null;

        applyInitialState();
        if (!didOverflow) {
          for (const bufferedMsg of buffered) {
            dispatchGameplayMessage(bufferedMsg);
          }
        }

        if (!useGameStore.getState().gameState) {
          return;
        }

        // Start the matching peer if either the passive probe promoted a new negotiation
        // OR a peer-reconnected notification arrived while guest confirmation was pending.
        let targetNegotiation: { negotiationId: number | null; initiator: boolean } | null = null;
        if (rejoinPromotion && retainedReconnect) {
          if (
            retainedReconnect.negotiationId !== null &&
            retainedReconnect.negotiationId > rejoinPromotion.negotiationId
          ) {
            targetNegotiation = retainedReconnect;
          } else {
            targetNegotiation = rejoinPromotion;
          }
        } else if (rejoinPromotion) {
          targetNegotiation = rejoinPromotion;
        } else if (retainedReconnect) {
          targetNegotiation = retainedReconnect;
        }

        if (targetNegotiation) {
          if (targetNegotiation.negotiationId !== null) {
            startedNegotiationIdRef.current = targetNegotiation.negotiationId;
            activeNegotiationIdRef.current = targetNegotiation.negotiationId;
          }
          const matchingSignals = consumePendingFutureSignals(
            activeNegotiationIdRef.current,
            roomCode,
          );
          setConnectionError(null);
          ensureReconnectDeadline();
          void createPeer(targetNegotiation.initiator, roomCode!, {
            negotiationId: activeNegotiationIdRef.current,
            ...(matchingSignals.length > 0 ? { initialSignals: matchingSignals } : {}),
          });
          return;
        }

        if (isPeerConnected()) {
          setConnectionError(null);
          setConnectionStatus('connected');
          if (didOverflow) {
            // Queue hit memory/count cap while waiting for confirmation: request an
            // authoritative full-state resync instead of silently dropping ordered actions.
            useGameStore.getState().requestResync();
          }
        } else {
          // Server committed the match, but the peer channel closed while awaiting ACK:
          // retain opening state and enter active-game recovery instead of publishing 'connected'.
          setConnectionError(null);
          startReconnection();
        }
      };

      const expireConfirmed = () => {
        // Never mutate guest confirmation state if a newer session owns it.
        if (!isCurrentConfirmation()) return;

        // Server committed the match, but the reconciliation window has expired:
        // commit the opening state (and any non-overflowed buffered actions) and
        // transition to expired recovery ('disconnected') without starting a new peer.
        const buffered = queuedGuestMessagesRef.current.splice(0);
        const didOverflow = queuedGuestOverflowedRef.current;
        clearGuestConfirmationState();
        applyInitialState();
        if (!didOverflow) {
          for (const bufferedMsg of buffered) {
            dispatchGameplayMessage(bufferedMsg);
          }
        }
        destroyPeer();
        setConnectionError(null);
        setConnectionStatus('disconnected');
      };

      const abortUnstarted = () => {
        // Never mutate guest confirmation state if a newer session owns it.
        if (!isCurrentConfirmation()) return;

        unconfirmedGuestStartRef.current = null;
        clearGuestConfirmationState();
        destroyPeer();
        setConnectionError(
          'Lost connection to the game room before the match started. Please rejoin.',
        );
        setConnectionStatus('connecting');
      };

      const parkUnconfirmedStart = () => {
        // Never mutate guest confirmation state if a newer session owns it.
        if (!isCurrentConfirmation()) return;

        // Reconciliation expired without a definitive server rejection: stop automatic
        // retries, but retain the opening state and reconnect credentials so an explicit
        // token-based retry can confirm and resume if the server actually started the room.
        const bufferedMessages = queuedGuestMessagesRef.current.splice(0);
        const overflowed = queuedGuestOverflowedRef.current;
        clearGuestConfirmationState();
        if (roomCode && reconnectToken) {
          unconfirmedGuestStartRef.current = {
            roomCode,
            reconnectToken,
            applyInitialState,
            bufferedMessages,
            overflowed,
          };
        }
        destroyPeer();
        setConnectionError(
          'Could not confirm whether the match started while offline. Retry once back online, or go back to the lobby.',
        );
        setConnectionStatus('connecting');
      };

      const handleReconcileDeadlineExpired = () => {
        // If a peer-reconnected notification for this pending join already proved the
        // server committed the match, preserve the opening state and report expired
        // recovery ('disconnected'). Otherwise, park the unconfirmed start for an
        // explicit token-based retry rather than treating expiry as a server rejection.
        if (pendingPeerReconnectedRef.current !== null) {
          expireConfirmed();
        } else {
          parkUnconfirmedStart();
        }
      };

      // Require server confirmation of `peer-connected` before entering the match.
      // If signaling drops ambiguously (server may have committed before sending ACK),
      // keep opening state staged and retry reconciliation within a bounded window.
      void (async () => {
        const outcome = await confirmPeerConnected(roomCode ?? '', negId);
        if (!isCurrentConfirmation()) return;

        if (outcome === 'confirmed') {
          finalizeConfirmed();
          return;
        }
        if (outcome === 'rejected' || !roomCode || !reconnectToken) {
          abortUnstarted();
          return;
        }

        const deadline = performance.now() + RECONNECT_TIMEOUT_MS;
        while (isCurrentConfirmation()) {
          const remaining = deadline - performance.now();
          if (remaining <= 0) {
            handleReconcileDeadlineExpired();
            return;
          }
          try {
            if (!isSignalingConnected()) {
              await connectSignaling(Math.min(4_000, remaining));
            }
            if (!isCurrentConfirmation()) return;

            const remainingForRejoin = deadline - performance.now();
            if (remainingForRejoin <= 0) {
              handleReconcileDeadlineExpired();
              return;
            }
            const reconcile = await rejoinSignalingRoom(
              roomCode,
              'guest',
              reconnectToken,
              Math.min(4_000, remainingForRejoin),
              { passive: isPeerConnected() },
            );
            if (!isCurrentConfirmation()) return;

            if (!reconcile.success) {
              // Explicit negative response from server: room was never started or expired.
              abortUnstarted();
              return;
            }
            if (performance.now() >= deadline) {
              expireConfirmed();
              return;
            }
            const alreadyStartedLocally =
              reconcile.negotiationId !== undefined &&
              (startedNegotiationIdRef.current === reconcile.negotiationId ||
                (completedNegotiationIdRef.current !== null &&
                  reconcile.negotiationId <= completedNegotiationIdRef.current));
            const promoted =
              reconcile.peerPresent &&
              reconcile.negotiationId !== undefined &&
              !alreadyStartedLocally &&
              (!reconcile.alreadyNegotiating ||
                reconcile.negotiationId > activeNegotiationIdRef.current ||
                !isPeerConnected())
                ? {
                    negotiationId: reconcile.negotiationId,
                    initiator: reconcile.role ? reconcile.role === 'host' : false,
                  }
                : undefined;
            finalizeConfirmed(promoted);
            return;
          } catch {
            // Probe timed out or disconnected: keep opening state staged and retry within deadline.
            if (!isCurrentConfirmation()) return;
            const remainingAfterErr = deadline - performance.now();
            if (remainingAfterErr <= 0) {
              handleReconcileDeadlineExpired();
              return;
            }
            if (remainingAfterErr <= 250) {
              // Too little time left for another probe, but keep confirmation open until the
              // deadline so a peer-reconnected notification can still preserve the opening state.
              await new Promise<void>((resolve) => {
                guestReconcileCancelRef.current = resolve;
                guestReconcileTimerRef.current = setTimeout(() => {
                  guestReconcileTimerRef.current = null;
                  guestReconcileCancelRef.current = null;
                  resolve();
                }, remainingAfterErr);
              });
              if (!isCurrentConfirmation()) return;
              handleReconcileDeadlineExpired();
              return;
            }
            const retryDelay = Math.min(SIGNALING_RETRY_DELAY_MS, remainingAfterErr - 200);
            await new Promise<void>((resolve) => {
              guestReconcileCancelRef.current = resolve;
              guestReconcileTimerRef.current = setTimeout(() => {
                guestReconcileTimerRef.current = null;
                guestReconcileCancelRef.current = null;
                resolve();
              }, retryDelay);
            });
          }
        }
      })();
    };

    setMessageHandler((msg: PeerMessage) => {
      switch (msg.type) {
        case 'sync-seed': {
          handleGuestInitialState(() => {
            initGame(msg.seed, msg.dealer);
          });
          break;
        }
        case 'resume-game': {
          handleGuestInitialState(() => {
            receiveResumeGame(msg.state);
          });
          break;
        }
        case 'game-action':
        case 'new-round':
        case 'round-ready':
        case 'rematch-ready':
        case 'rematch-start':
        case 'resync-request':
        case 'game-state':
          if (pendingInitialGuestConfirmRef.current) {
            if (!queuedGuestOverflowedRef.current) {
              const serializedBytes = JSON.stringify(msg).length * 2;
              if (
                queuedGuestMessagesRef.current.length + 1 > MAX_QUEUED_GUEST_MESSAGES ||
                queuedGuestBytesRef.current + serializedBytes > MAX_QUEUED_GUEST_BYTES
              ) {
                // Cap reached: release retained messages and request a full-state resync on confirm.
                queuedGuestOverflowedRef.current = true;
                queuedGuestMessagesRef.current = [];
                queuedGuestBytesRef.current = 0;
              } else {
                queuedGuestMessagesRef.current.push(msg);
                queuedGuestBytesRef.current += serializedBytes;
              }
            }
          } else {
            dispatchGameplayMessage(msg);
          }
          break;
      }
    });

    const restoreSignalingSeatPassively = (
      completedNegotiationId: number | null,
      isRetry = false,
    ) => {
      if (passiveRestoreRetryTimerRef.current !== null) {
        clearTimeout(passiveRestoreRetryTimerRef.current);
        passiveRestoreRetryTimerRef.current = null;
      }
      const { gameState, roomCode, reconnectToken, isHost, connectionStatus } =
        useGameStore.getState();
      if (
        !gameState ||
        !roomCode ||
        !reconnectToken ||
        connectionStatus === 'disconnected' ||
        reconnectingRef.current ||
        !isPeerConnected() ||
        !isSignalingConnected()
      ) {
        return;
      }
      const sessionId = sessionIdRef.current;
      const role = isHost ? 'host' : 'guest';
      pendingRejoinRequestsRef.current += 1;
      void rejoinSignalingRoom(
        roomCode,
        role,
        reconnectToken,
        SIGNALING_RECONNECT_TIMEOUT_MS,
        { passive: true, ...(isRetry ? { retry: true } : {}) },
      )
        .then((result) => {
          const latest = useGameStore.getState();
          if (
            sessionIdRef.current !== sessionId ||
            !latest.gameState ||
            latest.roomCode !== roomCode ||
            latest.connectionStatus === 'disconnected'
          ) {
            return;
          }
          passiveRestoreAttemptsRef.current = 0;
          // If the opponent was waiting for `peer-reconnected` or had an unmatched pending
          // negotiation we have not started locally, start our matching peer so both sides
          // use the same negotiation.
          if (
            result.success &&
            result.peerPresent &&
            result.negotiationId !== undefined
          ) {
            if (
              result.negotiationId >= activeNegotiationIdRef.current &&
              (completedNegotiationIdRef.current === null ||
                result.negotiationId > completedNegotiationIdRef.current) &&
              startedNegotiationIdRef.current !== result.negotiationId
            ) {
              // The reconnect deadline is terminal; do not start a replacement after it.
              if (reconnectingRef.current && performance.now() >= reconnectDeadlineRef.current) return;
              startedNegotiationIdRef.current = result.negotiationId;
              activeNegotiationIdRef.current = result.negotiationId;
              const initiator = result.role ? result.role === 'host' : latest.isHost;
              const initialSignals = consumePendingFutureSignals(
                activeNegotiationIdRef.current,
                roomCode,
              );
              ensureReconnectDeadline();
              void createPeer(initiator, roomCode, {
                negotiationId: activeNegotiationIdRef.current,
                ...(initialSignals.length > 0 ? { initialSignals } : {}),
              });
              return;
            }
          }
          // Only emit negotiation completion if no newer negotiation superseded this ACK.
          if (
            completedNegotiationId !== null &&
            result.success &&
            activeNegotiationIdRef.current === completedNegotiationId &&
            !reconnectingRef.current &&
            isPeerConnected()
          ) {
            notifyPeerConnected(roomCode, completedNegotiationId);
          }
        })
        .catch(() => {
          // Retry passive seat restoration with a bounded delay while the data channel
          // remains healthy so the server does not expire the unbound seat after 2 minutes.
          const latest = useGameStore.getState();
          if (
            sessionIdRef.current !== sessionId ||
            !latest.gameState ||
            latest.roomCode !== roomCode ||
            latest.connectionStatus === 'disconnected' ||
            reconnectingRef.current ||
            !isPeerConnected() ||
            !isSignalingConnected()
          ) {
            return;
          }
          if (passiveRestoreAttemptsRef.current >= MAX_PASSIVE_RESTORE_ATTEMPTS) {
            return;
          }
          passiveRestoreAttemptsRef.current += 1;
          if (passiveRestoreRetryTimerRef.current !== null) {
            clearTimeout(passiveRestoreRetryTimerRef.current);
          }
          passiveRestoreRetryTimerRef.current = setTimeout(() => {
            passiveRestoreRetryTimerRef.current = null;
            if (sessionIdRef.current !== sessionId) return;
            restoreSignalingSeatPassively(completedNegotiationId, true);
          }, PASSIVE_RESTORE_RETRY_DELAY_MS);
        })
        .finally(() => {
          if (sessionIdRef.current === sessionId) {
            pendingRejoinRequestsRef.current = Math.max(0, pendingRejoinRequestsRef.current - 1);
          }
        });
    };

    setStatusHandler((status) => {
      if (status === 'connected') {
        // The reconnect deadline is terminal: if a replacement channel opens after the
        // deadline has elapsed (before the timeout callback fires), fail recovery instead.
        if (reconnectingRef.current && performance.now() >= reconnectDeadlineRef.current) {
          failReconnection(reconnectAttemptIdRef.current);
          return;
        }
        const completedNegotiationId = activeNegotiationIdRef.current;
        completedNegotiationIdRef.current = completedNegotiationId;
        clearReconnectState();
        startedNegotiationIdRef.current = null;
        setConnectionError(null);

        const store = useGameStore.getState();
        if (!store.gameState) {
          // Initial lobby/join handshake: host deals or sends resumed snapshot.
          if (store.isHost) {
            if (store.pendingResumeState) {
              const resumed = store.pendingResumeState;
              if (!sendPeerMessage({ type: 'resume-game', state: resumed })) {
                destroyPeer();
                setConnectionError(
                  "Couldn't send the saved match to your opponent. Please try again.",
                );
                setConnectionStatus('in-lobby');
                return;
              }
              setConnectionStatus('connected');
              provisionalInitialResumeRef.current = resumed;
              store.hydrateGame(resumed);
            } else {
              // Allow tests/debugging to pin a specific deck via ?seed= in the URL.
              const seedOverride = new URLSearchParams(window.location.search)
                .get('seed')
                ?.trim();
              const seed =
                seedOverride ||
                (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                  ? crypto.randomUUID()
                  : Math.random().toString(36).substring(2));
              const dealer: 0 | 1 = 0;
              if (!sendPeerMessage({ type: 'sync-seed', seed, dealer })) {
                destroyPeer();
                setConnectionError(
                  "Couldn't send the opening deal to your opponent. Please try again.",
                );
                setConnectionStatus('in-lobby');
                return;
              }
              setConnectionStatus('connected');
              provisionalInitialResumeRef.current = null;
              store.initGame(seed, dealer);
            }
          } else {
            // Guest stays in 'connecting' until sync-seed / resume-game initializes
            // the match, keeping the join screen and Back button available if setup fails.
          }
        } else {
          // Reconnected during an active game: restore signaling seat (in case
          // signaling reconnected on a new socket during ICE recovery), notify
          // server that this specific negotiation completed, and resync state.
          setConnectionStatus('connected');
          if (store.roomCode) {
            if (isSignalingConnected() && store.reconnectToken) {
              restoreSignalingSeatPassively(completedNegotiationId);
            } else {
              notifyPeerConnected(store.roomCode, completedNegotiationId);
            }
          }
          if (store.isHost) {
            store.sendFullState();
          } else {
            store.requestResync();
          }
        }
      } else if (status === 'disconnected') {
        const { gameState } = useGameStore.getState();
        if (gameState) {
          if (reconnectingRef.current) {
            // A replacement peer (or ICE restart) failed before the reconnect
            // deadline expired: coordinate a fresh negotiation within the deadline.
            const attemptId = reconnectAttemptIdRef.current;
            if (iceFallbackTimerRef.current !== null) {
              clearTimeout(iceFallbackTimerRef.current);
              iceFallbackTimerRef.current = null;
              void escalateToSignalingRejoin(attemptId, false);
            } else {
              scheduleSignalingRetry(attemptId, true, activeNegotiationIdRef.current);
            }
          } else {
            startReconnection();
          }
        } else if (!pendingInitialGuestConfirmRef.current) {
          setConnectionError(
            "Couldn't establish a direct connection. This often happens on cellular networks. Try Wi-Fi, or tap Back and try again.",
          );
        }
      }
    });

    const socket = getSocket();

    // When signaling reconnects during an active game:
    // - If active recovery is waiting (e.g. after peerPresent: false and a signaling blip),
    //   resume active rejoin on the new socket within the existing deadline (unless already in flight).
    // - Otherwise, passively restore our signaling seat while the WebRTC data channel stays open.
    const handleSignalingConnect = () => {
      if (reconnectingRef.current && !isPeerConnected()) {
        if (!activeRejoinInFlightRef.current && iceFallbackTimerRef.current === null) {
          let isRetry = false;
          let failedNegotiationId: number | undefined;
          if (signalingRetryTimerRef.current !== null) {
            clearTimeout(signalingRetryTimerRef.current);
            signalingRetryTimerRef.current = null;
            const scheduled = pendingScheduledRetryRef.current;
            pendingScheduledRetryRef.current = null;
            if (scheduled) {
              // Apply retry metadata only for the current negotiation. A stale retry's
              // metadata is discarded, while the rejoin below still binds the new socket.
              if (scheduled.armedNegotiationId === activeNegotiationIdRef.current) {
                isRetry = scheduled.isRetry;
                failedNegotiationId = scheduled.failedNegotiationId;
              }
            }
          }
          void escalateToSignalingRejoin(
            reconnectAttemptIdRef.current,
            isRetry,
            failedNegotiationId,
          );
        }
        return;
      }
      restoreSignalingSeatPassively(null);
    };

    const resetProvisionalHostState = (gameState: GameState | null) => {
      clearReconnectState();
      destroyPeer();
      startedNegotiationIdRef.current = null;
      completedNegotiationIdRef.current = null;
      activeNegotiationIdRef.current = 0;
      if (gameState) {
        const resumeToRestore =
          gameState.sequenceNumber > 0 ? gameState : provisionalInitialResumeRef.current;
        provisionalInitialResumeRef.current = null;
        useGameStore.setState({
          gameState: null,
          pendingResumeState: resumeToRestore,
        });
      } else {
        provisionalInitialResumeRef.current = null;
      }
    };

    const handlePeerJoined = () => {
      const { roomCode, gameState, isHost } = useGameStore.getState();
      if (!roomCode || !isHost) return;
      // The server only emits peer-joined while the room is still unstarted
      // (before guest peer-connected confirmation). If the host already dealt a
      // provisional opening hand whose channel failed before guest confirmation,
      // reset provisional state so the retrying guest receives a fresh offer and deal.
      if (gameState) {
        resetProvisionalHostState(gameState);
        setConnectionStatus('in-lobby');
      }
      setConnectionError(null);
      void createPeer(true, roomCode, {
        negotiationId: activeNegotiationIdRef.current,
      });
    };

    const handlePeerJoinCancelled = () => {
      const { gameState, isHost, roomCode } = useGameStore.getState();
      if (!isHost || !roomCode) return;
      // The server only emits peer-join-cancelled while the room is still unstarted
      // (before guest peer-connected confirmation). Always return the host to a
      // joinable lobby state and preserve any accepted progress for resumption.
      resetProvisionalHostState(gameState);
      setConnectionError(null);
      setConnectionStatus('in-lobby');
    };

    const handlePeerReconnected = (data?: { role?: string; negotiationId?: number }) => {
      const { roomCode, isHost, gameState, connectionStatus } = useGameStore.getState();
      // Treat the 18-second reconnect deadline as terminal: once disconnected,
      // late peer-reconnected notifications must not revive the session.
      if (!roomCode || connectionStatus === 'disconnected') return;

      const negotiationId = data?.negotiationId ?? null;
      if (!gameState) {
        // Retain peer-reconnected notifications received while the guest is awaiting
        // initial confirmation OR resuming a parked unconfirmed opening so the matching
        // peer starts as soon as the opening state is applied.
        if (pendingInitialGuestConfirmRef.current || unconfirmedGuestStartRef.current !== null) {
          const prev = pendingPeerReconnectedRef.current;
          if (
            !prev ||
            (negotiationId !== null &&
              (prev.negotiationId === null || negotiationId > prev.negotiationId))
          ) {
            pendingPeerReconnectedRef.current = { negotiationId, initiator: isHost };
          }
        }
        return;
      }
      if (reconnectingRef.current && performance.now() >= reconnectDeadlineRef.current) return;
      if (
        negotiationId !== null &&
        (negotiationId < activeNegotiationIdRef.current ||
          (completedNegotiationIdRef.current !== null &&
            negotiationId <= completedNegotiationIdRef.current) ||
          startedNegotiationIdRef.current === negotiationId)
      ) {
        return;
      }

      if (iceFallbackTimerRef.current !== null) {
        clearTimeout(iceFallbackTimerRef.current);
        iceFallbackTimerRef.current = null;
      }
      if (signalingRetryTimerRef.current !== null) {
        clearTimeout(signalingRetryTimerRef.current);
        signalingRetryTimerRef.current = null;
        pendingScheduledRetryRef.current = null;
      }

      if (negotiationId !== null) {
        startedNegotiationIdRef.current = negotiationId;
        activeNegotiationIdRef.current = negotiationId;
      }

      ensureReconnectDeadline();
      const initialSignals = consumePendingFutureSignals(
        activeNegotiationIdRef.current,
        roomCode,
      );
      void createPeer(isHost, roomCode, {
        negotiationId: activeNegotiationIdRef.current,
        ...(initialSignals.length > 0 ? { initialSignals } : {}),
      });
    };

    const handlePeerDisconnected = (data?: { preserved?: boolean; roomCode?: string }) => {
      const { gameState, connectionStatus, roomCode: storeRoomCode } = useGameStore.getState();
      const eventRoomCode =
        typeof data?.roomCode === 'string' ? data.roomCode.trim().toUpperCase() : null;
      const currentRoomCode =
        pendingJoinRoomCodeRef.current ??
        storeRoomCode?.trim().toUpperCase() ??
        unconfirmedGuestStartRef.current?.roomCode ??
        null;
      if (eventRoomCode && (!currentRoomCode || eventRoomCode !== currentRoomCode)) {
        // Ignore stale disconnect/closure notifications from a previous room.
        return;
      }

      // Handle explicit departures before checking the data channel so the
      // remaining peer never enters recovery for a room the opponent closed.
      if (data?.preserved === false) {
        unconfirmedGuestStartRef.current = null;
        clearGuestConfirmationState();
        clearReconnectState();
        pendingRejoinRequestsRef.current = 0;
        pendingFutureSignalsRef.current = [];
        pendingFutureSignalBytesRef.current = 0;
        startedNegotiationIdRef.current = null;
        sessionIdRef.current += 1;
        destroyPeer();
        setConnectionStatus('disconnected');
        return;
      }

      // Once the WebRTC data channel is open, unexpected signaling disconnects
      // shouldn't block an active game; real peer drops are reported by peer.ts.
      if (isPeerConnected()) return;

      // While guest initial confirmation is in flight or a parked unconfirmed start
      // is awaiting an explicit retry, a preserved disconnect means the server still
      // reserves the room; leave confirmation / retry in control instead of showing disconnected.
      if (pendingInitialGuestConfirmRef.current || unconfirmedGuestStartRef.current !== null) return;

      if (gameState) {
        // Keep the 18-second reconnect deadline terminal: once disconnected,
        // preserved disconnect notifications must not start a fresh attempt.
        if (connectionStatus === 'disconnected') return;
        // Opponent dropped unexpectedly — keep/start reconnection until grace expires.
        startReconnection();
        return;
      }

      destroyPeer();
      setConnectionStatus('disconnected');
    };

    // Buffer signals belonging to a pending negotiation while:
    // - joinGame is awaiting join-room before the initial negotiation-0 peer is installed, OR
    // - the guest is awaiting initial confirmation, active reconnection is running, OR any
    //   rejoin request is still awaiting its ACK (for strictly newer negotiations).
    const handlePendingFutureSignal = (data?: { signal?: unknown; roomCode?: string }) => {
      const bufferingInitialJoin = awaitingInitialJoinPeerRef.current;
      if (
        !bufferingInitialJoin &&
        !pendingInitialGuestConfirmRef.current &&
        !reconnectingRef.current &&
        pendingRejoinRequestsRef.current <= 0
      ) {
        return;
      }
      if (!data || !isSignalPayload(data.signal)) return;
      const eventRoomCode =
        typeof data.roomCode === 'string' ? data.roomCode.trim().toUpperCase() : null;
      const targetRoomCode =
        pendingJoinRoomCodeRef.current ??
        useGameStore.getState().roomCode?.trim().toUpperCase() ??
        unconfirmedGuestStartRef.current?.roomCode ??
        null;
      if (eventRoomCode && targetRoomCode && eventRoomCode !== targetRoomCode) {
        return;
      }
      const sigNegId = data.signal.negotiationId ?? (bufferingInitialJoin ? 0 : undefined);
      const shouldBuffer =
        sigNegId !== undefined &&
        (bufferingInitialJoin
          ? sigNegId >= activeNegotiationIdRef.current
          : sigNegId > activeNegotiationIdRef.current);
      if (
        shouldBuffer &&
        pendingFutureSignalsRef.current.length < MAX_PENDING_FUTURE_SIGNALS
      ) {
        const estimatedBytes = JSON.stringify(data.signal).length * 2;
        if (
          pendingFutureSignalBytesRef.current + estimatedBytes <=
          MAX_PENDING_FUTURE_SIGNAL_BYTES
        ) {
          pendingFutureSignalsRef.current.push({
            signal: data.signal,
            bytes: estimatedBytes,
            roomCode: eventRoomCode,
          });
          pendingFutureSignalBytesRef.current += estimatedBytes;
        }
      }
    };

    socket.on('connect', handleSignalingConnect);
    socket.on('signal', handlePendingFutureSignal);
    socket.on('peer-joined', handlePeerJoined);
    socket.on('peer-join-cancelled', handlePeerJoinCancelled);
    socket.on('peer-reconnected', handlePeerReconnected);
    socket.on('peer-disconnected', handlePeerDisconnected);

    return () => {
      sessionIdRef.current += 1;
      startedNegotiationIdRef.current = null;
      completedNegotiationIdRef.current = null;
      provisionalInitialResumeRef.current = null;
      pendingRejoinRequestsRef.current = 0;
      unconfirmedGuestStartRef.current = null;
      resumeUnconfirmedStartRef.current = null;
      clearGuestConfirmationState();
      clearReconnectState();
      socket.off('connect', handleSignalingConnect);
      socket.off('signal', handlePendingFutureSignal);
      socket.off('peer-joined', handlePeerJoined);
      socket.off('peer-join-cancelled', handlePeerJoinCancelled);
      socket.off('peer-reconnected', handlePeerReconnected);
      socket.off('peer-disconnected', handlePeerDisconnected);
      destroyPeer();
      disconnectSignaling();
    };
  }, [
    clearGuestConfirmationState,
    clearReconnectState,
    consumePendingFutureSignals,
    setConnectionStatus,
    setConnectionError,
    initGame,
    receiveResumeGame,
    receiveAction,
    receiveNextRound,
    receiveRoundReady,
    receiveRematchReady,
    receiveRematchStart,
    sendFullState,
    receiveGameState,
  ]);

  const hostGame = useCallback(async () => {
    sessionIdRef.current += 1;
    startedNegotiationIdRef.current = null;
    activeNegotiationIdRef.current = 0;
    completedNegotiationIdRef.current = null;
    provisionalInitialResumeRef.current = null;
    pendingRejoinRequestsRef.current = 0;
    unconfirmedGuestStartRef.current = null;
    clearGuestConfirmationState();
    clearReconnectState();
    setConnectionError(null);
    setPendingResumeState(null);
    await connectSignaling();
    void getIceServers();
    const { code, reconnectToken } = await createSignalingRoom();
    setRoomCode(code);
    setReconnectToken(reconnectToken);
    setIsHost(true);
    setLocalPlayer(0);
    setConnectionStatus('in-lobby');
  }, [
    clearGuestConfirmationState,
    clearReconnectState,
    setConnectionError,
    setPendingResumeState,
    setRoomCode,
    setReconnectToken,
    setIsHost,
    setLocalPlayer,
    setConnectionStatus,
  ]);

  const resumeGame = useCallback(async (savedState: GameState) => {
    sessionIdRef.current += 1;
    startedNegotiationIdRef.current = null;
    activeNegotiationIdRef.current = 0;
    completedNegotiationIdRef.current = null;
    provisionalInitialResumeRef.current = null;
    pendingRejoinRequestsRef.current = 0;
    unconfirmedGuestStartRef.current = null;
    clearGuestConfirmationState();
    clearReconnectState();
    setConnectionError(null);
    await connectSignaling();
    void getIceServers();
    const { code, reconnectToken } = await createSignalingRoom();
    setPendingResumeState(savedState);
    setRoomCode(code);
    setReconnectToken(reconnectToken);
    setIsHost(true);
    setLocalPlayer(0);
    setConnectionStatus('in-lobby');
  }, [
    clearGuestConfirmationState,
    clearReconnectState,
    setConnectionError,
    setPendingResumeState,
    setRoomCode,
    setReconnectToken,
    setIsHost,
    setLocalPlayer,
    setConnectionStatus,
  ]);

  const joinGame = useCallback(async (code: string) => {
    const normalizedCode = code.trim().toUpperCase();
    // While guest initial confirmation is actively resolving for this room, keep
    // confirmation in control until it succeeds, rejects, or parks the opening.
    if (
      pendingInitialGuestConfirmRef.current &&
      useGameStore.getState().roomCode === normalizedCode
    ) {
      return;
    }
    const savedUnconfirmed =
      unconfirmedGuestStartRef.current?.roomCode === normalizedCode
        ? unconfirmedGuestStartRef.current
        : null;
    if (!savedUnconfirmed) {
      unconfirmedGuestStartRef.current = null;
    }

    const mySessionId = ++sessionIdRef.current;
    startedNegotiationIdRef.current = null;
    activeNegotiationIdRef.current = 0;
    completedNegotiationIdRef.current = null;
    provisionalInitialResumeRef.current = null;
    pendingRejoinRequestsRef.current = 0;
    clearGuestConfirmationState();
    clearReconnectState();
    destroyPeer();
    pendingJoinRoomCodeRef.current = normalizedCode;
    setConnectionError(null);
    setPendingResumeState(null);
    try {
      await connectSignaling();
      if (sessionIdRef.current !== mySessionId) return;
      void getIceServers();

      if (savedUnconfirmed) {
        // Stop if the room was explicitly closed while signaling was connecting.
        if (unconfirmedGuestStartRef.current !== savedUnconfirmed) return;
        let rejoinTracked = false;
        try {
          pendingRejoinRequestsRef.current += 1;
          rejoinTracked = true;
          // A parked guest holds no offer for any prior negotiation, so pass retry: true
          // (without failedNegotiationId) to mint a fresh negotiation and notify the host
          // even on the same socket within the dedupe window.
          const rejoinResult = await rejoinSignalingRoom(
            normalizedCode,
            'guest',
            savedUnconfirmed.reconnectToken,
            SIGNALING_RECONNECT_TIMEOUT_MS,
            { passive: false, retry: true },
          );
          // Abort if a newer session started OR a remote room closure invalidated the parked start.
          if (
            sessionIdRef.current !== mySessionId ||
            unconfirmedGuestStartRef.current !== savedUnconfirmed
          ) {
            return;
          }
          if (rejoinResult.success) {
            setRoomCode(normalizedCode);
            setReconnectToken(savedUnconfirmed.reconnectToken);
            setIsHost(false);
            setLocalPlayer(1);
            resumeUnconfirmedStartRef.current?.(savedUnconfirmed, rejoinResult);
            return;
          }
          // Server explicitly confirmed the room never started or expired:
          // discard the parked opening state and fall through to a fresh join.
          unconfirmedGuestStartRef.current = null;
        } finally {
          if (rejoinTracked && sessionIdRef.current === mySessionId) {
            pendingRejoinRequestsRef.current = Math.max(0, pendingRejoinRequestsRef.current - 1);
          }
        }
      }

      awaitingInitialJoinPeerRef.current = true;
      const result = await joinSignalingRoom(
        normalizedCode,
        undefined,
        () => sessionIdRef.current === mySessionId,
      );
      if (sessionIdRef.current !== mySessionId) return;
      if (!result.success) {
        throw new Error(result.error || 'Failed to join room');
      }

      setRoomCode(normalizedCode);
      setReconnectToken(result.reconnectToken ?? null);
      setIsHost(false);
      setLocalPlayer(1);
      setConnectionStatus('connecting');

      const initialSignals = consumePendingFutureSignals(
        activeNegotiationIdRef.current,
        normalizedCode,
      );
      awaitingInitialJoinPeerRef.current = false;
      void createPeer(false, normalizedCode, {
        negotiationId: activeNegotiationIdRef.current,
        ...(initialSignals.length > 0 ? { initialSignals } : {}),
      });
    } finally {
      if (sessionIdRef.current === mySessionId) {
        pendingJoinRoomCodeRef.current = null;
        awaitingInitialJoinPeerRef.current = false;
      }
    }
  }, [
    clearGuestConfirmationState,
    clearReconnectState,
    consumePendingFutureSignals,
    setConnectionError,
    setPendingResumeState,
    setRoomCode,
    setReconnectToken,
    setIsHost,
    setLocalPlayer,
    setConnectionStatus,
  ]);

  const cancelConnection = useCallback(() => {
    const { roomCode, reconnectToken, isHost } = useGameStore.getState();
    sessionIdRef.current += 1;
    startedNegotiationIdRef.current = null;
    activeNegotiationIdRef.current = 0;
    completedNegotiationIdRef.current = null;
    provisionalInitialResumeRef.current = null;
    pendingRejoinRequestsRef.current = 0;
    unconfirmedGuestStartRef.current = null;
    clearGuestConfirmationState();
    clearReconnectState();
    const credentials =
      roomCode && reconnectToken
        ? { code: roomCode, role: (isHost ? 'host' : 'guest') as 'host' | 'guest', token: reconnectToken }
        : undefined;
    leaveSignalingRoom(credentials, { disconnectAfter: true });
    destroyPeer();
    useGameStore.getState().resetConnection();
  }, [clearGuestConfirmationState, clearReconnectState]);

  return { hostGame, resumeGame, joinGame, cancelConnection };
}

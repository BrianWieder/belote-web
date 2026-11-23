import { useEffect, useCallback, useRef } from 'react';
import {
  connectSignaling,
  createRoom as createSignalingRoom,
  joinRoom as joinSignalingRoom,
  disconnectSignaling,
  getSocket,
} from '../networking/signaling';
import {
  createPeer,
  setMessageHandler,
  setStatusHandler,
  sendPeerMessage,
  destroyPeer,
  isPeerConnected,
} from '../networking/peer';
import { useGameStore } from '../store/gameStore';
import type { PeerMessage } from '../networking/peer';
import type { GameState } from '../game/types';

export function usePeer() {
  const setConnectionStatus = useGameStore((s) => s.setConnectionStatus);
  const setConnectionError = useGameStore((s) => s.setConnectionError);
  const setRoomCode = useGameStore((s) => s.setRoomCode);
  const setIsHost = useGameStore((s) => s.setIsHost);
  const setLocalPlayer = useGameStore((s) => s.setLocalPlayer);
  const setPendingResumeState = useGameStore((s) => s.setPendingResumeState);
  const initGame = useGameStore((s) => s.initGame);
  const receiveResumeGame = useGameStore((s) => s.receiveResumeGame);
  const receiveAction = useGameStore((s) => s.receiveAction);
  const receiveNextRound = useGameStore((s) => s.receiveNextRound);
  const sendFullState = useGameStore((s) => s.sendFullState);
  const receiveGameState = useGameStore((s) => s.receiveGameState);

  const checkConnectionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMessageHandler((msg: PeerMessage) => {
      switch (msg.type) {
        case 'sync-seed':
          initGame(msg.seed, msg.dealer);
          break;
        case 'resume-game':
          receiveResumeGame(msg.state);
          break;
        case 'game-action':
          receiveAction(msg.action, msg.seq);
          break;
        case 'new-round':
          receiveNextRound(msg.seq);
          break;
        case 'resync-request':
          sendFullState();
          break;
        case 'game-state':
          receiveGameState(msg.state);
          break;
      }
    });

    setStatusHandler((status) => {
      if (status === 'connected') {
        setConnectionError(null);
        setConnectionStatus('connected');
      } else if (status === 'disconnected') {
        // If a game is in progress, mark disconnected. Otherwise we're still
        // setting up the WebRTC connection — surface an error in the lobby
        // instead of silently dropping the user back to the home screen.
        const { gameState } = useGameStore.getState();
        if (gameState) {
          setConnectionStatus('disconnected');
        } else {
          setConnectionError(
            "Couldn't establish a direct connection. This often happens on cellular networks. Try Wi-Fi, or tap Back and try again."
          );
        }
      }
    });

    const socket = getSocket();

    const handlePeerJoined = () => {
      const { roomCode } = useGameStore.getState();
      if (!roomCode) return;
      createPeer(true, roomCode);

      // Wait for connection, then send seed or resumed snapshot. Track the
      // interval so it is cleared if the connection never establishes or is cancelled.
      if (checkConnectionRef.current) clearInterval(checkConnectionRef.current);
      checkConnectionRef.current = setInterval(() => {
        const store = useGameStore.getState();
        if (store.connectionStatus === 'connected' && store.isHost) {
          if (checkConnectionRef.current) clearInterval(checkConnectionRef.current);
          checkConnectionRef.current = null;
          if (store.pendingResumeState) {
            const resumed = store.pendingResumeState;
            sendPeerMessage({ type: 'resume-game', state: resumed });
            store.hydrateGame(resumed);
          } else {
            // Allow tests/debugging to pin a specific deck via ?seed= in the URL.
            const seed =
              new URLSearchParams(window.location.search).get('seed') ??
              (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : Math.random().toString(36).substring(2));
            const dealer: 0 | 1 = 0;
            sendPeerMessage({ type: 'sync-seed', seed, dealer });
            store.initGame(seed, dealer);
          }
        }
      }, 100);
    };

    const handlePeerDisconnected = () => {
      // Once the WebRTC data channel is open, signaling disconnects shouldn't
      // block an active game; real peer drops are reported by peer.ts.
      if (isPeerConnected()) return;
      // Clear any pending host seed-sync polling from this room.
      if (checkConnectionRef.current) {
        clearInterval(checkConnectionRef.current);
        checkConnectionRef.current = null;
      }
      destroyPeer();
      setConnectionStatus('disconnected');
    };

    socket.on('peer-joined', handlePeerJoined);
    socket.on('peer-disconnected', handlePeerDisconnected);

    return () => {
      if (checkConnectionRef.current) clearInterval(checkConnectionRef.current);
      checkConnectionRef.current = null;
      socket.off('peer-joined', handlePeerJoined);
      socket.off('peer-disconnected', handlePeerDisconnected);
      destroyPeer();
      disconnectSignaling();
    };
  }, [
    setConnectionStatus,
    setConnectionError,
    initGame,
    receiveResumeGame,
    receiveAction,
    receiveNextRound,
    sendFullState,
    receiveGameState,
  ]);

  const hostGame = useCallback(async () => {
    setConnectionError(null);
    setPendingResumeState(null);
    await connectSignaling();
    const code = await createSignalingRoom();
    setRoomCode(code);
    setIsHost(true);
    setLocalPlayer(0);
    setConnectionStatus('in-lobby');
  }, [setConnectionError, setPendingResumeState, setRoomCode, setIsHost, setLocalPlayer, setConnectionStatus]);

  const resumeGame = useCallback(async (savedState: GameState) => {
    setConnectionError(null);
    await connectSignaling();
    const code = await createSignalingRoom();
    setPendingResumeState(savedState);
    setRoomCode(code);
    setIsHost(true);
    setLocalPlayer(0);
    setConnectionStatus('in-lobby');
  }, [setConnectionError, setPendingResumeState, setRoomCode, setIsHost, setLocalPlayer, setConnectionStatus]);

  const joinGame = useCallback(async (code: string) => {
    setConnectionError(null);
    setPendingResumeState(null);
    await connectSignaling();
    const result = await joinSignalingRoom(code);
    if (!result.success) {
      throw new Error(result.error || 'Failed to join room');
    }

    setRoomCode(code);
    setIsHost(false);
    setLocalPlayer(1);
    setConnectionStatus('connecting');

    createPeer(false, code);
  }, [setConnectionError, setPendingResumeState, setRoomCode, setIsHost, setLocalPlayer, setConnectionStatus]);

  const cancelConnection = useCallback(() => {
    if (checkConnectionRef.current) clearInterval(checkConnectionRef.current);
    checkConnectionRef.current = null;
    destroyPeer();
    disconnectSignaling();
    useGameStore.getState().resetConnection();
  }, []);

  return { hostGame, resumeGame, joinGame, cancelConnection };
}

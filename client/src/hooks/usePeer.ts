import { useEffect, useCallback } from 'react';
import {
  connectSignaling,
  createRoom as createSignalingRoom,
  joinRoom as joinSignalingRoom,
  disconnectSignaling,
} from '../networking/signaling';
import {
  createPeer,
  setMessageHandler,
  setStatusHandler,
  sendPeerMessage,
  destroyPeer,
} from '../networking/peer';
import { getSocket } from '../networking/signaling';
import { useGameStore } from '../store/gameStore';
import type { PeerMessage } from '../networking/peer';

export function usePeer() {
  const {
    setConnectionStatus,
    setConnectionError,
    setRoomCode,
    setIsHost,
    setLocalPlayer,
    initGame,
    receiveAction,
    receiveNextRound,
  } = useGameStore();

  useEffect(() => {
    setMessageHandler((msg: PeerMessage) => {
      switch (msg.type) {
        case 'sync-seed':
          initGame(msg.seed, msg.dealer);
          break;
        case 'game-action':
          receiveAction(msg.action);
          break;
        case 'new-round':
          receiveNextRound();
          break;
        case 'heartbeat':
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

    return () => {
      destroyPeer();
      disconnectSignaling();
    };
  }, []);

  const hostGame = useCallback(async () => {
    setConnectionError(null);
    await connectSignaling();
    const code = await createSignalingRoom();
    setRoomCode(code);
    setIsHost(true);
    setLocalPlayer(0);
    setConnectionStatus('in-lobby');

    const socket = getSocket();
    socket.on('peer-joined', () => {
      createPeer(true, code);

      // Wait for connection, then send seed
      const checkConnection = setInterval(() => {
        const store = useGameStore.getState();
        if (store.connectionStatus === 'connected') {
          clearInterval(checkConnection);
          const seed = Math.random().toString(36).substring(2);
          const dealer: 0 | 1 = 0;
          sendPeerMessage({ type: 'sync-seed', seed, dealer });
          initGame(seed, dealer);
        }
      }, 100);
    });
  }, []);

  const joinGame = useCallback(async (code: string) => {
    setConnectionError(null);
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
  }, []);

  const cancelConnection = useCallback(() => {
    destroyPeer();
    disconnectSignaling();
    useGameStore.getState().resetConnection();
  }, []);

  return { hostGame, joinGame, cancelConnection };
}

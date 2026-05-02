import SimplePeer from 'simple-peer';
import { getSocket, sendSignal } from './signaling';
import type { GameAction } from '../game/types';

export type PeerMessage =
  | { type: 'sync-seed'; seed: string; dealer: 0 | 1 }
  | { type: 'game-action'; action: GameAction; seq: number }
  | { type: 'ack'; seq: number }
  | { type: 'heartbeat' }
  | { type: 'new-round' };

type MessageHandler = (msg: PeerMessage) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;

let peer: SimplePeer.Instance | null = null;
let peerConnected = false;
let messageHandler: MessageHandler | null = null;
let statusHandler: StatusHandler | null = null;
let roomCode: string = '';

export function setMessageHandler(handler: MessageHandler): void {
  messageHandler = handler;
}

export function setStatusHandler(handler: StatusHandler): void {
  statusHandler = handler;
}

export function createPeer(isInitiator: boolean, code: string): void {
  roomCode = code;

  peer = new SimplePeer({
    initiator: isInitiator,
    trickle: true,
  });

  statusHandler?.('connecting');

  peer.on('signal', (signal) => {
    sendSignal(roomCode, signal);
  });

  peer.on('connect', () => {
    peerConnected = true;
    statusHandler?.('connected');
  });

  peer.on('data', (data: Uint8Array) => {
    // Mark as connected when we receive data (fallback for environments
    // where peer.connected isn't set reliably)
    if (!peerConnected) {
      peerConnected = true;
      statusHandler?.('connected');
    }
    const msg = JSON.parse(new TextDecoder().decode(data)) as PeerMessage;
    messageHandler?.(msg);
  });

  peer.on('close', () => {
    peerConnected = false;
    statusHandler?.('disconnected');
  });

  peer.on('error', (err) => {
    console.error('Peer error:', err);
    statusHandler?.('disconnected');
  });

  // Listen for signaling data from the other peer
  const socket = getSocket();
  socket.on('signal', (data: { signal: unknown }) => {
    peer?.signal(data.signal as SimplePeer.SignalData);
  });
}

export function sendPeerMessage(msg: PeerMessage): void {
  if (peer && peerConnected) {
    peer.send(JSON.stringify(msg));
  }
}

export function destroyPeer(): void {
  if (peer) {
    peer.destroy();
    peer = null;
    peerConnected = false;
  }
}

export function isPeerConnected(): boolean {
  return peerConnected;
}

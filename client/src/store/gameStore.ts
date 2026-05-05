import { create } from 'zustand';
import type { GameState, GameAction, PlayerID, Card } from '../game/types';
import { createInitialState, applyAction, startNewRound } from '../game/engine';
import { getPlayableCards, isBeloteCard, hasBelotePair } from '../game/validation';
import { sendPeerMessage } from '../networking/peer';

export type ConnectionStatus = 'disconnected' | 'in-lobby' | 'connecting' | 'connected';

interface GameStore {
  // Connection state
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  roomCode: string | null;
  isHost: boolean;
  localPlayer: PlayerID;

  // Game state
  gameState: GameState | null;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionError: (err: string | null) => void;
  resetConnection: () => void;
  setRoomCode: (code: string | null) => void;
  setIsHost: (isHost: boolean) => void;
  setLocalPlayer: (player: PlayerID) => void;

  initGame: (seed: string, dealer: PlayerID) => void;
  performAction: (action: GameAction) => void;
  receiveAction: (action: GameAction) => void;
  nextRound: () => void;
  receiveNextRound: () => void;

  // Derived
  getPlayableCards: () => Card[];
  isMyTurn: () => boolean;
  canAnnounceBelote: (card: Card) => boolean;
}

export const useGameStore = create<GameStore>((set, get) => ({
  connectionStatus: 'disconnected',
  connectionError: null,
  roomCode: null,
  isHost: false,
  localPlayer: 0,
  gameState: null,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setConnectionError: (err) => set({ connectionError: err }),
  resetConnection: () => set({
    connectionStatus: 'disconnected',
    connectionError: null,
    roomCode: null,
    isHost: false,
    localPlayer: 0,
    gameState: null,
  }),
  setRoomCode: (code) => set({ roomCode: code }),
  setIsHost: (isHost) => set({ isHost }),
  setLocalPlayer: (player) => set({ localPlayer: player }),

  initGame: (seed, dealer) => {
    const state = createInitialState(seed, dealer);
    set({ gameState: state });
  },

  performAction: (action) => {
    const { gameState, localPlayer } = get();
    if (!gameState) return;

    const next = applyAction(gameState, localPlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    set({ gameState: next });
    sendPeerMessage({
      type: 'game-action',
      action,
      seq: next.sequenceNumber,
    });
  },

  receiveAction: (action) => {
    const { gameState, localPlayer } = get();
    if (!gameState) return;

    const remotePlayer: PlayerID = localPlayer === 0 ? 1 : 0;
    const next = applyAction(gameState, remotePlayer, action);
    set({ gameState: next });
  },

  nextRound: () => {
    const { gameState } = get();
    if (!gameState || gameState.phase !== 'round-over') return;

    const next = startNewRound(gameState);
    set({ gameState: next });
    sendPeerMessage({ type: 'new-round' });
  },

  receiveNextRound: () => {
    const { gameState } = get();
    if (!gameState || gameState.phase !== 'round-over') return;

    const next = startNewRound(gameState);
    set({ gameState: next });
  },

  getPlayableCards: () => {
    const { gameState } = get();
    if (!gameState || gameState.phase !== 'playing') return [];
    return getPlayableCards(gameState);
  },

  isMyTurn: () => {
    const { gameState, localPlayer } = get();
    if (!gameState) return false;
    return gameState.currentPlayer === localPlayer;
  },

  canAnnounceBelote: (card) => {
    const { gameState, localPlayer } = get();
    if (!gameState || !gameState.trumpSuit) return false;
    if (!isBeloteCard(card, gameState.trumpSuit)) return false;
    const handCards = gameState.hands[localPlayer];
    const tableauFaceUp = gameState.tableau[localPlayer]
      .map(s => s.faceUp)
      .filter((c): c is import('../game/types').Card => c !== null);
    return hasBelotePair([...handCards, ...tableauFaceUp], gameState.trumpSuit);
  },
}));

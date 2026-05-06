import { create } from 'zustand';
import * as Sentry from '@sentry/react';
import type { GameState, GameAction, PlayerID, Card } from '../game/types';
import { createInitialState, applyAction, startNewRound } from '../game/engine';
import { getPlayableCards, isBeloteCard, hasBelotePair } from '../game/validation';
import { sendPeerMessage } from '../networking/peer';

function setSentryGameContext(gameState: GameState | null, localPlayer: PlayerID) {
  if (!gameState) return;
  Sentry.setContext('game', {
    seed: gameState.seed,
    phase: gameState.phase,
    dealer: gameState.dealer,
    currentPlayer: gameState.currentPlayer,
    trumpSuit: gameState.trumpSuit,
    taker: gameState.taker,
    sequenceNumber: gameState.sequenceNumber,
    gameScore: gameState.gameScore,
    roundNumber: gameState.roundScores.length + 1,
  });
  Sentry.setTag('playerRole', localPlayer === 0 ? 'host' : 'guest');
  Sentry.setTag('gamePhase', gameState.phase);
}

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
    setSentryGameContext(state, get().localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Game initialized (seed: ${seed}, dealer: ${dealer})`, level: 'info' });
  },

  performAction: (action) => {
    const { gameState, localPlayer } = get();
    if (!gameState) return;

    const next = applyAction(gameState, localPlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    set({ gameState: next });
    setSentryGameContext(next, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Local action: ${action.type}`, level: 'info', data: action });
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
    setSentryGameContext(next, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Remote action: ${action.type}`, level: 'info', data: action });
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

import { create } from 'zustand';
import * as Sentry from '@sentry/react';
import type { GameState, GameAction, PlayerID, Card } from '../game/types';
import { createInitialState, applyAction, startNewRound } from '../game/engine';
import { getPlayableCards } from '../game/validation';
import { sendPeerMessage } from '../networking/peer';
import { isValidResumableGameState, saveHostGame } from './savedGame';

function persistIfHost(gameState: GameState, isHost: boolean, localPlayer: PlayerID): boolean {
  if (isHost && localPlayer === 0) {
    return saveHostGame(gameState);
  }
  return false;
}

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
  pendingResumeState: GameState | null;
  hostGameSaved: boolean;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionError: (err: string | null) => void;
  resetConnection: () => void;
  setRoomCode: (code: string | null) => void;
  setIsHost: (isHost: boolean) => void;
  setLocalPlayer: (player: PlayerID) => void;
  setPendingResumeState: (state: GameState | null) => void;

  initGame: (seed: string, dealer: PlayerID) => void;
  hydrateGame: (state: GameState) => void;
  receiveResumeGame: (state: GameState) => void;
  performAction: (action: GameAction) => void;
  receiveAction: (action: GameAction, seq: number) => void;
  nextRound: () => void;
  receiveNextRound: () => void;
  requestResync: () => void;
  sendFullState: () => void;
  receiveGameState: (state: GameState) => void;

  // Derived
  getPlayableCards: () => Card[];
  isMyTurn: () => boolean;
}

export const useGameStore = create<GameStore>((set, get) => ({
  connectionStatus: 'disconnected',
  connectionError: null,
  roomCode: null,
  isHost: false,
  localPlayer: 0,
  gameState: null,
  pendingResumeState: null,
  hostGameSaved: false,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setConnectionError: (err) => set({ connectionError: err }),
  resetConnection: () => set({
    connectionStatus: 'disconnected',
    connectionError: null,
    roomCode: null,
    isHost: false,
    localPlayer: 0,
    gameState: null,
    pendingResumeState: null,
    hostGameSaved: false,
  }),
  setRoomCode: (code) => set({ roomCode: code }),
  setIsHost: (isHost) => set({ isHost }),
  setLocalPlayer: (player) => set({ localPlayer: player }),
  setPendingResumeState: (state) => set({ pendingResumeState: state }),

  initGame: (seed, dealer) => {
    const state = createInitialState(seed, dealer);
    const { isHost, localPlayer } = get();
    const saved = persistIfHost(state, isHost, localPlayer);
    set({ gameState: state, pendingResumeState: null, hostGameSaved: saved });
    setSentryGameContext(state, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Game initialized (seed: ${seed}, dealer: ${dealer})`, level: 'info' });
  },

  hydrateGame: (state) => {
    const { isHost, localPlayer } = get();
    const saved = persistIfHost(state, isHost, localPlayer);
    set({ gameState: state, pendingResumeState: null, hostGameSaved: saved });
    setSentryGameContext(state, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Game resumed (seed: ${state.seed}, seq: ${state.sequenceNumber})`, level: 'info' });
  },

  receiveResumeGame: (state) => {
    const { gameState, isHost } = get();
    // Only a joining guest with no active game should accept a resumed match snapshot.
    if (gameState || isHost) return;
    if (!isValidResumableGameState(state)) return;
    get().hydrateGame(state);
  },

  performAction: (action) => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState) return;

    const next = applyAction(gameState, localPlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setSentryGameContext(next, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Local action: ${action.type}`, level: 'info', data: action });
    sendPeerMessage({
      type: 'game-action',
      action,
      seq: next.sequenceNumber,
    });
  },

  receiveAction: (action, seq) => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState) return;

    const expectedSeq = gameState.sequenceNumber + 1;
    if (seq !== expectedSeq) {
      // Out-of-order or dropped message: ask the other peer for a full state.
      Sentry.addBreadcrumb({
        category: 'game',
        message: `Sequence mismatch (got ${seq}, expected ${expectedSeq}) — requesting resync`,
        level: 'warning',
      });
      sendPeerMessage({ type: 'resync-request' });
      return;
    }

    const remotePlayer: PlayerID = localPlayer === 0 ? 1 : 0;
    const next = applyAction(gameState, remotePlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setSentryGameContext(next, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Remote action: ${action.type}`, level: 'info', data: action });
  },

  requestResync: () => {
    sendPeerMessage({ type: 'resync-request' });
  },

  sendFullState: () => {
    const { gameState } = get();
    if (gameState) {
      sendPeerMessage({ type: 'game-state', state: gameState });
    }
  },

  receiveGameState: (state) => {
    const { gameState, isHost, localPlayer } = get();
    // Only accept a resync from a matching seed; applying a foreign state
    // would corrupt the local game.
    if (!gameState || state.seed !== gameState.seed) return;
    const saved = persistIfHost(state, isHost, localPlayer);
    set({ gameState: state, hostGameSaved: saved });
    setSentryGameContext(state, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: 'Received full state resync', level: 'info' });
  },

  nextRound: () => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState || gameState.phase !== 'round-over') return;

    const next = startNewRound(gameState);
    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setSentryGameContext(next, localPlayer);
    sendPeerMessage({ type: 'new-round' });
  },

  receiveNextRound: () => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState || gameState.phase !== 'round-over') return;

    const next = startNewRound(gameState);
    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setSentryGameContext(next, localPlayer);
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
}));

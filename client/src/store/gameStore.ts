import { create } from 'zustand';
import * as Sentry from '@sentry/react';
import type { GameState, GameAction, PlayerID, Card } from '../game/types';
import { createInitialState, applyAction, startNewRound } from '../game/engine';
import { getPlayableCards } from '../game/validation';
import { sendPeerMessage } from '../networking/peer';
import { isValidGameState, isValidResumableGameState, saveHostGame } from './savedGame';

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
  receiveNextRound: (seq?: number) => void;
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
    const { gameState, connectionStatus, isHost, localPlayer } = get();
    if (!gameState || connectionStatus !== 'connected') return;

    const next = applyAction(gameState, localPlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    if (
      sendPeerMessage({
        type: 'game-action',
        action,
        seq: next.sequenceNumber,
      }) === false
    ) {
      return;
    }

    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setSentryGameContext(next, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: `Local action: ${action.type}`, level: 'info', data: action });
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
    // Only accept a valid resync from a matching seed when the local game isn't
    // already over and the incoming snapshot isn't older than our local state.
    if (!gameState || gameState.phase === 'game-over') return;
    if (!isValidGameState(state)) return;
    if (state.seed !== gameState.seed) return;
    if (state.sequenceNumber < gameState.sequenceNumber) return;

    const saved = persistIfHost(state, isHost, localPlayer);
    set({ gameState: state, hostGameSaved: saved });
    setSentryGameContext(state, localPlayer);
    Sentry.addBreadcrumb({ category: 'game', message: 'Received full state resync', level: 'info' });
  },

  nextRound: () => {
    const { gameState, connectionStatus, isHost, localPlayer } = get();
    if (!gameState || gameState.phase !== 'round-over' || connectionStatus !== 'connected') return;

    const next = startNewRound(gameState);
    if (sendPeerMessage({ type: 'new-round', seq: next.sequenceNumber }) === false) {
      return;
    }

    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setSentryGameContext(next, localPlayer);
  },

  receiveNextRound: (seq) => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState || gameState.phase === 'game-over') return;

    if (gameState.phase !== 'round-over') {
      if (seq !== undefined && seq > gameState.sequenceNumber) {
        Sentry.addBreadcrumb({
          category: 'game',
          message: `New-round received in phase ${gameState.phase} (got seq ${seq}, local seq ${gameState.sequenceNumber}) — requesting resync`,
          level: 'warning',
        });
        sendPeerMessage({ type: 'resync-request' });
      }
      return;
    }

    const expectedSeq = gameState.sequenceNumber + 1;
    if (seq !== undefined && seq !== expectedSeq) {
      Sentry.addBreadcrumb({
        category: 'game',
        message: `New-round sequence mismatch (got ${seq}, expected ${expectedSeq}) — requesting resync`,
        level: 'warning',
      });
      sendPeerMessage({ type: 'resync-request' });
      return;
    }

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

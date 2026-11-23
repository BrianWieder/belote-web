import { create } from 'zustand';
import type { GameState, GameAction, PlayerID, Card } from '../game/types';
import { createInitialState, applyAction, startNewRound } from '../game/engine';
import { getPlayableCards } from '../game/validation';
import { sendPeerMessage } from '../networking/peer';
import { addGameBreadcrumb, setGameContext } from '../telemetry';
import { isValidGameState, isValidResumableGameState, saveHostGame } from './savedGame';

function persistIfHost(gameState: GameState, isHost: boolean, localPlayer: PlayerID): boolean {
  if (isHost && localPlayer === 0) {
    return saveHostGame(gameState);
  }
  return false;
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
    setGameContext(state, localPlayer);
    addGameBreadcrumb(`Game initialized (seed: ${seed}, dealer: ${dealer})`);
  },

  hydrateGame: (state) => {
    const { isHost, localPlayer } = get();
    const saved = persistIfHost(state, isHost, localPlayer);
    set({ gameState: state, pendingResumeState: null, hostGameSaved: saved });
    setGameContext(state, localPlayer);
    addGameBreadcrumb(`Game resumed (seed: ${state.seed}, seq: ${state.sequenceNumber})`);
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
    setGameContext(next, localPlayer);
    addGameBreadcrumb(`Local action: ${action.type}`, 'info', action);
  },

  receiveAction: (action, seq) => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState) return;

    const expectedSeq = gameState.sequenceNumber + 1;
    if (seq !== expectedSeq) {
      // Out-of-order or dropped message: ask the other peer for a full state.
      addGameBreadcrumb(
        `Sequence mismatch (got ${seq}, expected ${expectedSeq}) — requesting resync`,
        'warning',
      );
      sendPeerMessage({ type: 'resync-request' });
      return;
    }

    const remotePlayer: PlayerID = localPlayer === 0 ? 1 : 0;
    const next = applyAction(gameState, remotePlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setGameContext(next, localPlayer);
    addGameBreadcrumb(`Remote action: ${action.type}`, 'info', action);
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
    setGameContext(state, localPlayer);
    addGameBreadcrumb('Received full state resync');
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
    setGameContext(next, localPlayer);
  },

  receiveNextRound: (seq) => {
    const { gameState, isHost, localPlayer } = get();
    if (!gameState || gameState.phase === 'game-over') return;

    if (gameState.phase !== 'round-over') {
      if (seq !== undefined && seq > gameState.sequenceNumber) {
        addGameBreadcrumb(
          `New-round received in phase ${gameState.phase} (got seq ${seq}, local seq ${gameState.sequenceNumber}) — requesting resync`,
          'warning',
        );
        sendPeerMessage({ type: 'resync-request' });
      }
      return;
    }

    const expectedSeq = gameState.sequenceNumber + 1;
    if (seq !== undefined && seq !== expectedSeq) {
      addGameBreadcrumb(
        `New-round sequence mismatch (got ${seq}, expected ${expectedSeq}) — requesting resync`,
        'warning',
      );
      sendPeerMessage({ type: 'resync-request' });
      return;
    }

    const next = startNewRound(gameState);
    const saved = persistIfHost(next, isHost, localPlayer);
    set({ gameState: next, hostGameSaved: saved });
    setGameContext(next, localPlayer);
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

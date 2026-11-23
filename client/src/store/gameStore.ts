import { create } from 'zustand';
import type { GameState, GameAction, PlayerID, Card } from '../game/types';
import type { BotDifficulty } from '../game/bot';
import { createInitialState, applyAction, startNewRound } from '../game/engine';
import { getPlayableCards } from '../game/validation';
import { sendPeerMessage } from '../networking/peer';
import { addGameBreadcrumb, setGameContext } from '../telemetry';
import { isValidGameState, isValidResumableGameState, saveHostGame } from './savedGame';
import { loadTwoTapPlay, saveTwoTapPlay } from './preferences';

export type GameMode = 'p2p' | 'bot';

function persistIfHost(
  gameState: GameState,
  isHost: boolean,
  localPlayer: PlayerID,
  gameMode: GameMode,
): boolean {
  if (gameMode === 'bot') return false;
  if (isHost && localPlayer === 0) {
    return saveHostGame(gameState);
  }
  return false;
}

function generateMatchSeed(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'in-lobby'
  | 'connecting'
  | 'reconnecting'
  | 'connected';

interface GameStore {
  // Connection state
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  roomCode: string | null;
  reconnectToken: string | null;
  isHost: boolean;
  localPlayer: PlayerID;
  gameMode: GameMode;
  botDifficulty: BotDifficulty;

  // Game state
  gameState: GameState | null;
  pendingResumeState: GameState | null;
  hostGameSaved: boolean;
  roundReady: [boolean, boolean];
  rematchReady: [boolean, boolean];
  pendingRematchStart: { previousSeed: string; seed: string; dealer: PlayerID } | null;

  // UI preferences & interaction state
  twoTapPlay: boolean;
  selectedCardKey: string | null;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionError: (err: string | null) => void;
  resetConnection: () => void;
  setRoomCode: (code: string | null) => void;
  setReconnectToken: (token: string | null) => void;
  setIsHost: (isHost: boolean) => void;
  setLocalPlayer: (player: PlayerID) => void;
  setPendingResumeState: (state: GameState | null) => void;
  setBotDifficulty: (difficulty: BotDifficulty) => void;
  setTwoTapPlay: (enabled: boolean) => void;
  toggleTwoTapPlay: () => void;
  setSelectedCardKey: (key: string | null) => void;

  startBotGame: (difficulty?: BotDifficulty, dealer?: PlayerID) => void;
  performBotAction: (action: GameAction) => void;
  initGame: (seed: string, dealer: PlayerID) => void;
  hydrateGame: (state: GameState) => void;
  receiveResumeGame: (state: GameState) => void;
  performAction: (action: GameAction) => void;
  receiveAction: (action: GameAction, seq: number) => void;
  nextRound: () => void;
  markRoundReady: () => void;
  receiveRoundReady: (round: number) => void;
  receiveNextRound: (seq?: number) => void;
  requestRematch: () => void;
  receiveRematchReady: () => void;
  receiveRematchStart: (seed: string, dealer: PlayerID) => void;
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
  reconnectToken: null,
  isHost: false,
  localPlayer: 0,
  gameMode: 'p2p',
  botDifficulty: 'smart',
  gameState: null,
  pendingResumeState: null,
  hostGameSaved: false,
  roundReady: [false, false],
  rematchReady: [false, false],
  pendingRematchStart: null,
  twoTapPlay: loadTwoTapPlay(),
  selectedCardKey: null,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setConnectionError: (err) => set({ connectionError: err }),
  resetConnection: () => set({
    connectionStatus: 'disconnected',
    connectionError: null,
    roomCode: null,
    reconnectToken: null,
    isHost: false,
    localPlayer: 0,
    gameMode: 'p2p',
    gameState: null,
    pendingResumeState: null,
    hostGameSaved: false,
    roundReady: [false, false],
    rematchReady: [false, false],
    pendingRematchStart: null,
    selectedCardKey: null,
  }),
  setRoomCode: (code) => set({ roomCode: code }),
  setReconnectToken: (token) => set({ reconnectToken: token }),
  setIsHost: (isHost) => set({ isHost }),
  setLocalPlayer: (player) => set({ localPlayer: player }),
  setPendingResumeState: (state) => set({ pendingResumeState: state }),
  setBotDifficulty: (difficulty) => set({ botDifficulty: difficulty }),
  setTwoTapPlay: (enabled) => {
    saveTwoTapPlay(enabled);
    set((state) => ({
      twoTapPlay: enabled,
      selectedCardKey: enabled ? state.selectedCardKey : null,
    }));
  },
  toggleTwoTapPlay: () => {
    const next = !get().twoTapPlay;
    get().setTwoTapPlay(next);
  },
  setSelectedCardKey: (key) => set({ selectedCardKey: key }),

  startBotGame: (difficulty, dealer) => {
    const prev = get();
    const resolvedDifficulty = difficulty ?? prev.botDifficulty;
    const resolvedDealer: PlayerID =
      dealer ??
      (prev.gameMode === 'bot' && prev.gameState
        ? prev.gameState.dealer === 0
          ? 1
          : 0
        : 1);
    const seed = generateMatchSeed();
    const state = createInitialState(seed, resolvedDealer);

    set({
      gameMode: 'bot',
      botDifficulty: resolvedDifficulty,
      connectionStatus: 'connected',
      connectionError: null,
      roomCode: null,
      reconnectToken: null,
      isHost: false,
      localPlayer: 0,
      gameState: state,
      pendingResumeState: null,
      hostGameSaved: false,
      roundReady: [false, false],
      rematchReady: [false, false],
      pendingRematchStart: null,
      selectedCardKey: null,
    });
    setGameContext(state, 0, 'bot');
    addGameBreadcrumb(
      `Bot game started (difficulty: ${resolvedDifficulty}, dealer: ${resolvedDealer})`,
    );
  },

  performBotAction: (action) => {
    const { gameState, gameMode, localPlayer } = get();
    if (!gameState || gameMode !== 'bot') return;

    const botPlayer: PlayerID = localPlayer === 0 ? 1 : 0;
    if (gameState.currentPlayer !== botPlayer) return;

    const next = applyAction(gameState, botPlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return;

    set({ gameState: next, selectedCardKey: null });
    setGameContext(next, localPlayer, 'bot');
    addGameBreadcrumb(`Bot action: ${action.type}`, 'info', action);
  },

  initGame: (seed, dealer) => {
    const { isHost, localPlayer, gameMode } = get();
    if (gameMode === 'bot') return;
    const state = createInitialState(seed, dealer);
    const saved = persistIfHost(state, isHost, localPlayer, 'p2p');
    set({
      gameMode: 'p2p',
      gameState: state,
      pendingResumeState: null,
      hostGameSaved: saved,
      roundReady: [false, false],
      rematchReady: [false, false],
      pendingRematchStart: null,
      selectedCardKey: null,
    });
    setGameContext(state, localPlayer, 'p2p');
    addGameBreadcrumb(`Game initialized (seed: ${seed}, dealer: ${dealer})`);
  },

  hydrateGame: (state) => {
    const { isHost, localPlayer, gameMode } = get();
    if (gameMode === 'bot') return;
    const saved = persistIfHost(state, isHost, localPlayer, 'p2p');
    set({
      gameMode: 'p2p',
      gameState: state,
      pendingResumeState: null,
      hostGameSaved: saved,
      roundReady: [false, false],
      rematchReady: [false, false],
      pendingRematchStart: null,
      selectedCardKey: null,
    });
    setGameContext(state, localPlayer, 'p2p');
    addGameBreadcrumb(`Game resumed (seed: ${state.seed}, seq: ${state.sequenceNumber})`);
  },

  receiveResumeGame: (state) => {
    const { gameState, isHost, gameMode } = get();
    // Only a joining guest with no active game should accept a resumed match snapshot.
    if (gameMode === 'bot' || gameState || isHost) return;
    if (!isValidResumableGameState(state)) return;
    get().hydrateGame(state);
  },

  performAction: (action) => {
    const { gameState, connectionStatus, isHost, localPlayer, gameMode } = get();
    if (!gameState) return;
    if (gameMode !== 'bot' && connectionStatus !== 'connected') return;

    const next = applyAction(gameState, localPlayer, action);
    if (next.sequenceNumber === gameState.sequenceNumber) return; // action was rejected

    if (gameMode === 'bot') {
      set({ gameState: next, selectedCardKey: null });
      setGameContext(next, localPlayer, 'bot');
      addGameBreadcrumb(`Local action: ${action.type}`, 'info', action);
      return;
    }

    if (
      sendPeerMessage({
        type: 'game-action',
        action,
        seq: next.sequenceNumber,
      }) === false
    ) {
      return;
    }

    const saved = persistIfHost(next, isHost, localPlayer, gameMode);
    set({ gameState: next, hostGameSaved: saved, selectedCardKey: null });
    setGameContext(next, localPlayer, gameMode);
    addGameBreadcrumb(`Local action: ${action.type}`, 'info', action);
  },

  receiveAction: (action, seq) => {
    const { gameState, isHost, localPlayer, gameMode } = get();
    if (!gameState || gameMode === 'bot') return;

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

    const saved = persistIfHost(next, isHost, localPlayer, gameMode);
    set((prev) => ({
      gameState: next,
      hostGameSaved: saved,
      selectedCardKey: null,
      // Receiving a valid remote action on the rematch seed proves the guest received rematch-start.
      pendingRematchStart:
        prev.pendingRematchStart?.seed === next.seed ? null : prev.pendingRematchStart,
    }));
    setGameContext(next, localPlayer, gameMode);
    addGameBreadcrumb(`Remote action: ${action.type}`, 'info', action);
  },

  requestResync: () => {
    if (get().gameMode === 'bot') return;
    sendPeerMessage({ type: 'resync-request' });
  },

  sendFullState: () => {
    const { gameState, isHost, localPlayer, roundReady, rematchReady, pendingRematchStart, gameMode } = get();
    if (!gameState || gameMode === 'bot') return;
    // Replay rematch-start before game-state until the guest is confirmed on the new match,
    // so a disconnect right after host starts a rematch still transitions the guest cleanly.
    if (isHost && pendingRematchStart && pendingRematchStart.seed === gameState.seed) {
      sendPeerMessage({
        type: 'rematch-start',
        seed: pendingRematchStart.seed,
        dealer: pendingRematchStart.dealer,
      });
    }
    sendPeerMessage({ type: 'game-state', state: gameState });
    if (gameState.phase === 'round-over' && roundReady[localPlayer]) {
      sendPeerMessage({ type: 'round-ready', round: gameState.roundScores.length });
    } else if (gameState.phase === 'game-over' && rematchReady[localPlayer]) {
      sendPeerMessage({ type: 'rematch-ready' });
    }
  },

  receiveGameState: (state) => {
    const { gameState, isHost, localPlayer, roundReady, rematchReady, pendingRematchStart, gameMode } = get();
    // Only accept a valid resync from a matching seed; if our local state is
    // newer, push it back so both peers converge on the latest turn.
    if (!gameState || gameMode === 'bot') return;
    if (!isValidGameState(state)) return;
    if (state.seed !== gameState.seed) {
      // If the guest is still on the previous match's game-over screen because rematch-start
      // was lost across a disconnect, replay rematch-start + current state without overwriting ours.
      if (
        isHost &&
        pendingRematchStart &&
        pendingRematchStart.seed === gameState.seed &&
        state.seed === pendingRematchStart.previousSeed &&
        state.phase === 'game-over'
      ) {
        sendPeerMessage({
          type: 'rematch-start',
          seed: pendingRematchStart.seed,
          dealer: pendingRematchStart.dealer,
        });
        sendPeerMessage({ type: 'game-state', state: gameState });
      }
      return;
    }
    const confirmedRematch = pendingRematchStart?.seed === state.seed;
    if (state.sequenceNumber < gameState.sequenceNumber) {
      if (confirmedRematch) {
        set({ pendingRematchStart: null });
      }
      get().sendFullState();
      return;
    }
    if (gameState.phase === 'game-over') {
      if (state.phase === 'game-over' && rematchReady[localPlayer]) {
        sendPeerMessage({ type: 'rematch-ready' });
      }
      return;
    }
    // Never revert an already-advanced round back to round-over at the same sequence number.
    if (
      state.phase === 'round-over' &&
      gameState.phase !== 'round-over' &&
      state.sequenceNumber === gameState.sequenceNumber
    ) {
      return;
    }

    const saved = persistIfHost(state, isHost, localPlayer, gameMode);
    const keepRoundReady =
      gameState.phase === 'round-over' &&
      state.phase === 'round-over' &&
      state.sequenceNumber === gameState.sequenceNumber &&
      state.roundScores.length === gameState.roundScores.length;
    const nextRoundReady: [boolean, boolean] = keepRoundReady ? roundReady : [false, false];

    set({
      gameState: state,
      hostGameSaved: saved,
      selectedCardKey: null,
      roundReady: nextRoundReady,
      rematchReady: [false, false],
      pendingRematchStart: confirmedRematch ? null : pendingRematchStart,
    });
    setGameContext(state, localPlayer, gameMode);
    addGameBreadcrumb('Received full state resync');

    // Re-advertise local round readiness after a same-round resync so both peers
    // reconcile if an earlier round-ready message was dropped across a disconnect.
    if (state.phase === 'round-over' && nextRoundReady[localPlayer]) {
      sendPeerMessage({ type: 'round-ready', round: state.roundScores.length });
    }
  },

  nextRound: () => {
    const { gameState, connectionStatus, isHost, localPlayer, roundReady, gameMode } = get();
    if (!gameState || gameState.phase !== 'round-over') return;

    if (gameMode === 'bot') {
      const next = startNewRound(gameState);
      set({
        gameState: next,
        roundReady: [false, false],
        selectedCardKey: null,
      });
      setGameContext(next, localPlayer, 'bot');
      addGameBreadcrumb('Starting next round (bot mode)');
      return;
    }

    if (connectionStatus !== 'connected') return;
    if (roundReady[localPlayer]) return;

    const round = gameState.roundScores.length;
    if (sendPeerMessage({ type: 'round-ready', round }) === false) {
      return;
    }

    const nextReady: [boolean, boolean] = [roundReady[0], roundReady[1]];
    nextReady[localPlayer] = true;

    if (nextReady[0] && nextReady[1]) {
      const next = startNewRound(gameState);
      const saved = persistIfHost(next, isHost, localPlayer, gameMode);
      set({
        gameState: next,
        hostGameSaved: saved,
        roundReady: [false, false],
        selectedCardKey: null,
      });
      setGameContext(next, localPlayer, gameMode);
      addGameBreadcrumb('Both players ready — starting next round');
    } else {
      set({ roundReady: nextReady });
    }
  },

  markRoundReady: () => {
    get().nextRound();
  },

  receiveRoundReady: (round) => {
    const { gameState, isHost, localPlayer, roundReady, gameMode } = get();
    if (!gameState || gameMode === 'bot' || gameState.phase !== 'round-over') return;
    if (round !== gameState.roundScores.length) return;

    const remotePlayer: PlayerID = localPlayer === 0 ? 1 : 0;
    if (roundReady[remotePlayer]) return;

    const nextReady: [boolean, boolean] = [roundReady[0], roundReady[1]];
    nextReady[remotePlayer] = true;

    if (nextReady[0] && nextReady[1]) {
      const next = startNewRound(gameState);
      const saved = persistIfHost(next, isHost, localPlayer, gameMode);
      set({
        gameState: next,
        hostGameSaved: saved,
        roundReady: [false, false],
        selectedCardKey: null,
      });
      setGameContext(next, localPlayer, gameMode);
      addGameBreadcrumb('Both players ready — starting next round');
    } else {
      set({ roundReady: nextReady });
    }
  },

  receiveNextRound: (seq) => {
    const { gameState, isHost, localPlayer, gameMode } = get();
    if (!gameState || gameMode === 'bot' || gameState.phase === 'game-over') return;

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
    const saved = persistIfHost(next, isHost, localPlayer, gameMode);
    set({
      gameState: next,
      hostGameSaved: saved,
      roundReady: [false, false],
      selectedCardKey: null,
    });
    setGameContext(next, localPlayer, gameMode);
  },

  requestRematch: () => {
    const { gameState, connectionStatus, isHost, localPlayer, rematchReady, gameMode } = get();
    if (!gameState || gameState.phase !== 'game-over') return;

    if (gameMode === 'bot') {
      get().startBotGame();
      return;
    }

    if (connectionStatus !== 'connected') return;
    if (rematchReady[localPlayer]) return;

    if (sendPeerMessage({ type: 'rematch-ready' }) === false) {
      return;
    }

    const nextReady: [boolean, boolean] = [rematchReady[0], rematchReady[1]];
    nextReady[localPlayer] = true;

    if (nextReady[0] && nextReady[1] && isHost) {
      const previousSeed = gameState.seed;
      const seed = generateMatchSeed();
      const dealer: PlayerID = gameState.dealer === 0 ? 1 : 0;
      get().initGame(seed, dealer);
      // Retain rematch-start metadata until the guest is confirmed on the new match so
      // reconnects or dropped packets replay rematch-start seamlessly.
      set({ pendingRematchStart: { previousSeed, seed, dealer } });
      sendPeerMessage({ type: 'rematch-start', seed, dealer });
      return;
    }

    set({ rematchReady: nextReady });
  },

  receiveRematchReady: () => {
    const { gameState, isHost, localPlayer, rematchReady, pendingRematchStart, gameMode } = get();
    if (!gameState || gameMode === 'bot') return;
    // If host already started the rematch and guest re-sends rematch-ready (e.g. after reconnect),
    // replay rematch-start + current state so the guest catches up.
    if (isHost && pendingRematchStart && pendingRematchStart.seed === gameState.seed) {
      sendPeerMessage({
        type: 'rematch-start',
        seed: pendingRematchStart.seed,
        dealer: pendingRematchStart.dealer,
      });
      sendPeerMessage({ type: 'game-state', state: gameState });
      return;
    }
    if (gameState.phase !== 'game-over') return;

    const remotePlayer: PlayerID = localPlayer === 0 ? 1 : 0;
    if (rematchReady[remotePlayer]) return;

    const nextReady: [boolean, boolean] = [rematchReady[0], rematchReady[1]];
    nextReady[remotePlayer] = true;

    if (nextReady[0] && nextReady[1] && isHost) {
      const previousSeed = gameState.seed;
      const seed = generateMatchSeed();
      const dealer: PlayerID = gameState.dealer === 0 ? 1 : 0;
      get().initGame(seed, dealer);
      set({ pendingRematchStart: { previousSeed, seed, dealer } });
      sendPeerMessage({ type: 'rematch-start', seed, dealer });
      return;
    }

    set({ rematchReady: nextReady });
  },

  receiveRematchStart: (seed, dealer) => {
    const { gameState, isHost, localPlayer, rematchReady, gameMode } = get();
    if (gameMode === 'bot' || isHost || !gameState || gameState.phase !== 'game-over') return;
    if (!rematchReady[localPlayer]) return;
    if (!seed || (dealer !== 0 && dealer !== 1)) return;
    get().initGame(seed, dealer);
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

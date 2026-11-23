// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInitialState } from '../../game/engine';
import { DEFAULT_MATCH_OPTIONS } from '../../game/types';
import { useGameStore } from '../../store/gameStore';
import { saveHostGame, SAVED_GAME_STORAGE_KEY } from '../../store/savedGame';
import { PLAYER_NAME_STORAGE_KEY } from '../../store/playerName';
import { Lobby } from '../Lobby';

function createPeerActions() {
  return {
    hostGame: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    resumeGame: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    joinGame: vi.fn<(code: string) => Promise<void>>().mockResolvedValue(undefined),
    cancelConnection: vi.fn(),
  };
}

describe('Lobby component', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    useGameStore.getState().resetConnection();
    useGameStore.setState({
      matchOptions: { ...DEFAULT_MATCH_OPTIONS },
      botDifficulty: 'smart',
      localPlayerName: '',
      playerNames: [null, null],
      pendingResumeState: null,
      connectionError: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    useGameStore.getState().resetConnection();
  });

  it('updates player name, toggles custom table rules, and creates a room', async () => {
    const peerActions = createPeerActions();
    render(<Lobby peerActions={peerActions} />);

    // Enter player name and blur to trim
    const nameInput = screen.getByTestId('player-name-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '  Claire  ' } });
    fireEvent.blur(nameInput);
    expect(nameInput.value).toBe('Claire');
    expect(useGameStore.getState().localPlayerName).toBe('Claire');
    expect(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY)).toBe('Claire');

    // Expand Table rules, pick 500 + Capot
    const rulesToggle = screen.getByTestId('table-rules-toggle');
    expect(rulesToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(rulesToggle);
    expect(screen.getByTestId('table-rules-panel')).toBeTruthy();

    fireEvent.click(screen.getByTestId('target-score-500'));
    fireEvent.click(screen.getByTestId('capot-toggle'));
    expect(useGameStore.getState().matchOptions).toEqual({
      targetScore: 500,
      capotEnabled: true,
    });
    expect(rulesToggle.textContent).toContain('First to 500');
    expect(rulesToggle.textContent).toContain('Capot');

    // Create room calls hostGame
    fireEvent.click(screen.getByTestId('create-room'));
    await waitFor(() => {
      expect(peerActions.hostGame).toHaveBeenCalledTimes(1);
    });
  });

  it('sanitizes join code input, enables Join at 4 chars, and formats join errors', async () => {
    const peerActions = createPeerActions();
    peerActions.joinGame.mockRejectedValueOnce(new Error('Room not found or full'));
    render(<Lobby peerActions={peerActions} />);

    const codeInput = screen.getByTestId('join-code-input') as HTMLInputElement;
    const joinBtn = screen.getByTestId('join-room') as HTMLButtonElement;
    expect(joinBtn.disabled).toBe(true);

    // Non-alphanumeric characters are stripped and lowercased letters uppercased
    fireEvent.change(codeInput, { target: { value: 'ab-12!9' } });
    expect(codeInput.value).toBe('AB12');
    expect(joinBtn.disabled).toBe(false);

    fireEvent.click(joinBtn);
    await waitFor(() => {
      expect(peerActions.joinGame).toHaveBeenCalledWith('AB12');
    });
    expect(screen.getByRole('alert').textContent).toContain('Room not found or already full');
  });

  it('renders saved game card, resumes saved match, and supports discarding', async () => {
    const savedState = createInitialState('lobby-saved-test', 0);
    saveHostGame(savedState, window.localStorage);
    expect(window.localStorage.getItem(SAVED_GAME_STORAGE_KEY)).toBeTruthy();

    const peerActions = createPeerActions();
    render(<Lobby peerActions={peerActions} />);

    expect(screen.getByTestId('saved-game-card')).toBeTruthy();

    fireEvent.click(screen.getByTestId('resume-game'));
    await waitFor(() => {
      expect(peerActions.resumeGame).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('discard-saved-game'));
    expect(screen.queryByTestId('saved-game-card')).toBeNull();
    expect(window.localStorage.getItem(SAVED_GAME_STORAGE_KEY)).toBeNull();
  });

  it('starts a solo bot game with selected difficulty after canceling any pending connection', () => {
    const peerActions = createPeerActions();
    render(<Lobby peerActions={peerActions} />);

    fireEvent.click(screen.getByTestId('bot-difficulty-casual'));
    expect(useGameStore.getState().botDifficulty).toBe('casual');

    fireEvent.click(screen.getByTestId('play-vs-bot'));
    expect(peerActions.cancelConnection).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().gameMode).toBe('bot');
    expect(useGameStore.getState().gameState).not.toBeNull();
  });

  it('renders in-lobby waiting screen with room code, clipboard copy feedback, and Leave table', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    useGameStore.setState({
      connectionStatus: 'in-lobby',
      roomCode: 'XY7Z',
      matchOptions: { targetScore: 500, capotEnabled: true },
    });

    const peerActions = createPeerActions();
    render(<Lobby peerActions={peerActions} />);

    expect(screen.getByTestId('room-code').textContent?.trim()).toBe('XY7Z');
    expect(screen.getByText('First to 500')).toBeTruthy();
    expect(screen.getByText('Capot (252 pts)')).toBeTruthy();

    fireEvent.click(screen.getByTestId('copy-code'));
    await waitFor(() => {
      expect(screen.getByTestId('copy-code').textContent).toBe('Code copied');
    });
    expect(writeText).toHaveBeenCalledWith('XY7Z');

    fireEvent.click(screen.getByTestId('copy-link'));
    await waitFor(() => {
      expect(screen.getByTestId('copy-link').textContent).toBe('Link copied');
    });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('?join=XY7Z'));

    fireEvent.click(screen.getByText('Leave table'));
    expect(peerActions.cancelConnection).toHaveBeenCalledTimes(1);
  });

  it('renders connecting screen with retry button when connectionError is present', async () => {
    useGameStore.setState({
      connectionStatus: 'connecting',
      roomCode: 'Q9W8',
      connectionError: 'Timed out waiting for peer',
    });

    const peerActions = createPeerActions();
    render(<Lobby peerActions={peerActions} />);

    expect(screen.getByRole('alert').textContent).toContain('Timed out waiting for peer');
    fireEvent.click(screen.getByText('Retry connection'));
    await waitFor(() => {
      expect(peerActions.joinGame).toHaveBeenCalledWith('Q9W8');
    });

    fireEvent.click(screen.getByText('Back to lobby'));
    expect(peerActions.cancelConnection).toHaveBeenCalledTimes(1);
  });

  it('auto-joins from ?join=CODE invite URL and strips the query param', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/?join=ab9z');

    const peerActions = createPeerActions();
    render(<Lobby peerActions={peerActions} />);

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(peerActions.joinGame).toHaveBeenCalledWith('AB9Z');
    expect(window.location.search).toBe('');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState, applyAction } from '../../game/engine';

// Zustand v5 uses getInitialState() during SSR (renderToStaticMarkup), so have
// the hook read the live store state in this test suite.
vi.mock('../../store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/gameStore')>();
  const mockUseGameStore = Object.assign(
    <T,>(selector?: (state: ReturnType<typeof actual.useGameStore.getState>) => T) => {
      const state = actual.useGameStore.getState();
      return selector ? selector(state) : state;
    },
    actual.useGameStore,
  );
  return { ...actual, useGameStore: mockUseGameStore };
});

import { useGameStore } from '../../store/gameStore';
import { GameOver } from '../Scoreboard';
import { BiddingUI } from '../BiddingUI';
import { Hand } from '../Hand';
import { Tableau } from '../Tableau';

describe('GameOver draw and winner display', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameState: null,
      connectionStatus: 'connected',
      connectionError: null,
      roomCode: null,
      isHost: true,
      localPlayer: 0,
    });
  });

  function setupGameOver(gameScore: [number, number], localPlayer: 0 | 1 = 0) {
    const state = createInitialState('game-over-test', 0);
    state.phase = 'game-over';
    state.gameScore = gameScore;
    useGameStore.setState({ gameState: state, localPlayer });
  }

  it('renders "It\'s a Draw!" for both players on an exact tie at 1,000+', () => {
    setupGameOver([1020, 1020], 0);
    const p0Html = renderToStaticMarkup(<GameOver />);
    expect(p0Html).toMatch(/It(&#x27;|')s a Draw!/);
    expect(p0Html).not.toContain('You Win!');
    expect(p0Html).not.toContain('Opponent Wins');

    setupGameOver([1020, 1020], 1);
    const p1Html = renderToStaticMarkup(<GameOver />);
    expect(p1Html).toMatch(/It(&#x27;|')s a Draw!/);
    expect(p1Html).not.toContain('You Win!');
    expect(p1Html).not.toContain('Opponent Wins');
  });

  it('renders "You Win!" when local player has strictly more points', () => {
    setupGameOver([1050, 990], 0);
    const html = renderToStaticMarkup(<GameOver />);
    expect(html).toContain('You Win!');
    expect(html).not.toContain('Draw');
  });

  it('renders "Opponent Wins" when opponent has strictly more points', () => {
    setupGameOver([990, 1050], 0);
    const html = renderToStaticMarkup(<GameOver />);
    expect(html).toContain('Opponent Wins');
    expect(html).not.toContain('You Win!');
  });
});

describe('UI disables interactions when disconnected', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameState: null,
      connectionStatus: 'connected',
      connectionError: null,
      roomCode: null,
      isHost: false,
      localPlayer: 1,
    });
  });

  it('disables BiddingUI buttons when disconnected', () => {
    const state = createInitialState('bid-disconnect-test', 0);
    // Player 1 (non-dealer) has the first turn to bid.
    useGameStore.setState({ gameState: state, localPlayer: 1, connectionStatus: 'disconnected' });
    const disconnectedHtml = renderToStaticMarkup(<BiddingUI />);
    expect(disconnectedHtml).toMatch(/data-testid="bid-take"[^>]*\sdisabled=""/);

    useGameStore.setState({ connectionStatus: 'connected' });
    const connectedHtml = renderToStaticMarkup(<BiddingUI />);
    expect(connectedHtml).not.toMatch(/data-testid="bid-take"[^>]*\sdisabled=""/);
  });

  it('disables Hand and Tableau playable cards when disconnected', () => {
    const initial = createInitialState('play-disconnect-test', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    // Player 1 leads first trick.
    useGameStore.setState({ gameState: playing, localPlayer: 1, connectionStatus: 'disconnected' });

    const handHtml = renderToStaticMarkup(<Hand />);
    expect(handHtml).not.toContain('data-playable="true"');

    const tableauHtml = renderToStaticMarkup(<Tableau player={1} />);
    expect(tableauHtml).not.toContain('data-playable="true"');

    useGameStore.setState({ connectionStatus: 'connected' });
    const connectedHandHtml = renderToStaticMarkup(<Hand />);
    expect(connectedHandHtml).toContain('data-playable="true"');

    const connectedTableauHtml = renderToStaticMarkup(<Tableau player={1} />);
    expect(connectedTableauHtml).toContain('data-playable="true"');
  });
});

import { useGameStore } from './store/gameStore';
import { usePeer } from './hooks/usePeer';
import { Lobby } from './components/Lobby';
import { GameBoard } from './components/GameBoard';

function App() {
  const { gameState } = useGameStore();
  const peerActions = usePeer();

  if (gameState) {
    return <GameBoard />;
  }

  return <Lobby peerActions={peerActions} />;
}

export default App;

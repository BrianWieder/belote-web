import { useGameStore } from './store/gameStore';
import { usePeer } from './hooks/usePeer';
import { Lobby } from './components/Lobby';
import { GameBoard } from './components/GameBoard';

function App() {
  const hasGame = useGameStore((s) => s.gameState !== null);
  const peerActions = usePeer();

  if (hasGame) {
    return <GameBoard onReturnToLobby={peerActions.cancelConnection} />;
  }

  return <Lobby peerActions={peerActions} />;
}

export default App;

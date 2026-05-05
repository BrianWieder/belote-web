import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

interface LobbyProps {
  peerActions: {
    hostGame: () => Promise<void>;
    joinGame: (code: string) => Promise<void>;
    cancelConnection: () => void;
  };
}

export function Lobby({ peerActions }: LobbyProps) {
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { hostGame, joinGame, cancelConnection } = peerActions;
  const { connectionStatus, roomCode, connectionError } = useGameStore();

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      await hostGame();
    } catch (e) {
      setError('Failed to create room');
    }
    setLoading(false);
  };

  const handleJoin = async () => {
    if (joinCode.length !== 4) {
      setError('Enter a 4-character room code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await joinGame(joinCode.toUpperCase());
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  if (connectionStatus === 'in-lobby' && roomCode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white p-4">
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">Belote Maniée</h1>
        <div className="bg-green-800 rounded-xl p-8 shadow-xl text-center">
          <p className="text-lg mb-4">Waiting for opponent...</p>
          <p className="text-sm text-green-300 mb-2">Share this room code:</p>
          <div data-testid="room-code" className="text-4xl sm:text-5xl font-mono font-bold tracking-widest bg-green-700 rounded-lg px-4 py-3 sm:px-6 sm:py-4 mb-4">
            {roomCode}
          </div>
          <p className="text-xs text-green-400 mb-4">The game will start when your opponent joins</p>
          {connectionError && (
            <p className="text-sm text-red-300 bg-red-900/30 px-4 py-2 rounded mb-4">{connectionError}</p>
          )}
          <button
            onClick={cancelConnection}
            className="text-sm text-green-300 hover:text-white underline"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (connectionStatus === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white p-4">
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">Belote Maniée</h1>
        <div className="bg-green-800 rounded-xl p-8 shadow-xl text-center max-w-sm">
          <p className="text-lg mb-4">Connecting to opponent...</p>
          {connectionError && (
            <p className="text-sm text-red-300 bg-red-900/30 px-4 py-2 rounded mb-4">{connectionError}</p>
          )}
          <button
            onClick={cancelConnection}
            className="text-sm text-green-300 hover:text-white underline"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-green-900 text-white p-4">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Belote Maniée</h1>
      <p className="text-green-300 mb-8">2-Player Card Game</p>

      <div className="flex flex-col sm:flex-row gap-6">
        <div className="bg-green-800 rounded-xl p-6 shadow-xl w-full max-w-sm">
          <h2 className="text-xl font-semibold mb-4 text-center">Create Game</h2>
          <button
            data-testid="create-room"
            onClick={handleCreate}
            disabled={loading}
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold py-3 px-6 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Room'}
          </button>
        </div>

        <div className="bg-green-800 rounded-xl p-6 shadow-xl w-full max-w-sm">
          <h2 className="text-xl font-semibold mb-4 text-center">Join Game</h2>
          <input
            data-testid="join-code-input"
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="Room code"
            className="w-full bg-green-700 border border-green-600 rounded-lg px-4 py-3 text-center text-2xl font-mono tracking-widest placeholder:text-green-500 placeholder:text-base placeholder:tracking-normal mb-3 focus:outline-none focus:border-yellow-500"
          />
          <button
            data-testid="join-room"
            onClick={handleJoin}
            disabled={loading || joinCode.length !== 4}
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-green-900 font-bold py-3 px-6 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Joining...' : 'Join Room'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 text-red-400 bg-red-900/30 px-4 py-2 rounded">{error}</p>
      )}
    </div>
  );
}

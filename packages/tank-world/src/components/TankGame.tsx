import { useState } from 'react';
import clsx from 'clsx';
import { useTankGame } from '../hooks/useTankGame';
import type { Tank } from '../hooks/useTankGame';

const ConnectionStatus = ({ status, isConnected }: { status: string; isConnected: boolean }) => (
  <div className="flex items-center gap-2 mb-4">
    <div 
      className={clsx(
        'w-3 h-3 rounded-full',
        isConnected ? 'bg-green-500' : 'bg-red-500'
      )}
    />
    <span className="text-sm font-medium">
      Connection: {status}
    </span>
  </div>
);

const TankList = ({ 
  tanks, 
  title, 
  onMoveTank 
}: { 
  tanks: Tank[]; 
  title: string;
  onMoveTank: (tankId: number, x: number, y: number) => void;
}) => {
  const [selectedTank, setSelectedTank] = useState<number | null>(null);
  const [targetX, setTargetX] = useState('');
  const [targetY, setTargetY] = useState('');

  const handleMove = () => {
    if (selectedTank && targetX && targetY) {
      onMoveTank(selectedTank, parseFloat(targetX), parseFloat(targetY));
      setTargetX('');
      setTargetY('');
      setSelectedTank(null);
    }
  };

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">{title}</h3>
      
      {tanks.length === 0 ? (
        <p className="text-gray-500 text-sm">No tanks spawned</p>
      ) : (
        <div className="space-y-2">
          {tanks.map(tank => (
            <div 
              key={tank.id}
              className={clsx(
                'p-3 rounded border cursor-pointer transition-colors',
                selectedTank === tank.id 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                tank.hasActiveOrder && 'border-l-4 border-l-yellow-400'
              )}
              onClick={() => setSelectedTank(tank.id)}
              data-testid={`tank-${tank.id}`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    Tank #{tank.id}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Position: ({tank.x.toFixed(1)}, {tank.y.toFixed(1)})
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Health: {tank.health}/{tank.maxHealth}
                  </div>
                </div>
                <div className="flex flex-col items-end text-xs text-gray-500">
                  {tank.hasActiveOrder && (
                    <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                      Moving
                    </span>
                  )}
                  <span className="mt-1">
                    v: ({tank.velocityX.toFixed(1)}, {tank.velocityY.toFixed(1)})
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTank && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded border">
          <h4 className="font-medium mb-2 text-gray-900 dark:text-gray-100">
            Move Tank #{selectedTank}
          </h4>
          <div className="flex gap-2 mb-2">
            <input
              type="number"
              placeholder="Target X"
              value={targetX}
              onChange={(e) => setTargetX(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              data-testid="move-target-x"
            />
            <input
              type="number"
              placeholder="Target Y"
              value={targetY}
              onChange={(e) => setTargetY(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              data-testid="move-target-y"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleMove}
              className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors"
              data-testid="move-tank-button"
            >
              Move
            </button>
            <button
              onClick={() => setSelectedTank(null)}
              className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SpawnControls = ({ onSpawn }: { onSpawn: (team: 'red' | 'blue', x?: number, y?: number) => void }) => {
  const [spawnX, setSpawnX] = useState('');
  const [spawnY, setSpawnY] = useState('');

  const handleSpawn = (team: 'red' | 'blue') => {
    const x = spawnX ? parseFloat(spawnX) : undefined;
    const y = spawnY ? parseFloat(spawnY) : undefined;
    onSpawn(team, x, y);
  };

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Spawn Tank</h3>
      
      <div className="flex gap-2 mb-3">
        <input
          type="number"
          placeholder="Spawn X (optional)"
          value={spawnX}
          onChange={(e) => setSpawnX(e.target.value)}
          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          data-testid="spawn-x"
        />
        <input
          type="number"
          placeholder="Spawn Y (optional)"
          value={spawnY}
          onChange={(e) => setSpawnY(e.target.value)}
          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          data-testid="spawn-y"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handleSpawn('red')}
          className="flex-1 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors font-medium"
          data-testid="spawn-red-tank"
        >
          Spawn Red Tank
        </button>
        <button
          onClick={() => handleSpawn('blue')}
          className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors font-medium"
          data-testid="spawn-blue-tank"
        >
          Spawn Blue Tank
        </button>
      </div>
    </div>
  );
};

const GameEventLog = ({ events }: { events: any[] }) => (
  <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
    <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Game Events</h3>
    <div className="h-32 overflow-y-auto bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs">
      {events.length === 0 ? (
        <p className="text-gray-500">No events yet...</p>
      ) : (
        events.slice().reverse().map((event, idx) => (
          <div key={idx} className="mb-1 text-gray-700 dark:text-gray-300">
            <span className="text-gray-500 dark:text-gray-400">
              [{new Date(event.ts).toLocaleTimeString()}]
            </span>
            {' '}
            <span className="font-mono">{event.type}</span>
            {event.payload && (
              <span className="text-gray-600 dark:text-gray-400">
                {' '}- {JSON.stringify(event.payload).slice(0, 100)}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  </div>
);

export const TankGame = () => {
  const {
    connectionStatus,
    isConnected,
    tanksByTeam,
    gameEvents,
    spawnTank,
    moveTank,
    requestWorldState
  } = useTankGame();

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Tank World
        </h1>
        <ConnectionStatus status={connectionStatus} isConnected={isConnected} />
        
        <button
          onClick={requestWorldState}
          className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
          data-testid="refresh-world-state"
        >
          Refresh World State
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <TankList 
          tanks={tanksByTeam.red} 
          title={`Red Team (${tanksByTeam.red.length})`}
          onMoveTank={moveTank}
        />
        <TankList 
          tanks={tanksByTeam.blue} 
          title={`Blue Team (${tanksByTeam.blue.length})`}
          onMoveTank={moveTank}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SpawnControls onSpawn={spawnTank} />
        <GameEventLog events={gameEvents} />
      </div>
    </div>
  );
};
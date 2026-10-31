import { useState } from 'react';

import clsx from 'clsx';

import { useTankGame, type GameEvent, type Tank } from '../hooks/useTankGame';

const ConnectionStatus = ({
  isConnected,
  status
}: {
  isConnected: boolean;
  status: string;
}) => (
  <div className="mb-4 flex items-center gap-2">
    <div
      className={clsx(
        'h-3 w-3 rounded-full',
        isConnected ? 'bg-green-500' : 'bg-red-500'
      )}
    />
    <span className="text-sm font-medium">Connection: {status}</span>
  </div>
);

const TankList = ({
  onMoveTank,
  tanks,
  title
}: {
  onMoveTank: (tankId: number, x: number, y: number) => void;
  tanks: Tank[];
  title: string;
}) => {
  const [selectedTank, setSelectedTank] = useState<number | null>(null);
  const [targetX, setTargetX] = useState('');
  const [targetY, setTargetY] = useState('');

  const handleMove = () => {
    if (selectedTank && targetX && targetY) {
      onMoveTank(
        selectedTank,
        Number.parseFloat(targetX),
        Number.parseFloat(targetY)
      );
      setTargetX('');
      setTargetY('');
      setSelectedTank(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-300 p-4 dark:border-gray-600">
      <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>

      {tanks.length === 0 ? (
        <p className="text-sm text-gray-500">No tanks spawned</p>
      ) : (
        <div className="space-y-2">
          {tanks.map(tank => (
            <div
              className={clsx(
                'cursor-pointer rounded border p-3 transition-colors',
                selectedTank === tank.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                tank.hasActiveOrder && 'border-l-4 border-l-yellow-400'
              )}
              data-testid={`tank-${tank.id}`}
              key={tank.id}
              onClick={() => setSelectedTank(tank.id)}
            >
              <div className="flex items-start justify-between">
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
                    <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
                      Moving
                    </span>
                  )}
                  <span className="mt-1">
                    v: ({tank.velocityX.toFixed(1)}, {tank.velocityY.toFixed(1)}
                    )
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTank && (
        <div className="mt-4 rounded border bg-gray-50 p-3 dark:bg-gray-800">
          <h4 className="mb-2 font-medium text-gray-900 dark:text-gray-100">
            Move Tank #{selectedTank}
          </h4>
          <div className="mb-2 flex gap-2">
            <input
              className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              data-testid="move-target-x"
              onChange={e => setTargetX(e.target.value)}
              placeholder="Target X"
              type="number"
              value={targetX}
            />
            <input
              className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              data-testid="move-target-y"
              onChange={e => setTargetY(e.target.value)}
              placeholder="Target Y"
              type="number"
              value={targetY}
            />
          </div>
          <div className="flex gap-2">
            <button
              className="rounded bg-blue-500 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-600"
              data-testid="move-tank-button"
              onClick={handleMove}
            >
              Move
            </button>
            <button
              className="rounded bg-gray-500 px-3 py-1 text-sm text-white transition-colors hover:bg-gray-600"
              onClick={() => setSelectedTank(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SpawnControls = ({
  onSpawn
}: {
  onSpawn: (team: 'red' | 'blue', x?: number, y?: number) => void;
}) => {
  const [spawnX, setSpawnX] = useState('');
  const [spawnY, setSpawnY] = useState('');

  const handleSpawn = (team: 'red' | 'blue') => {
    const x = spawnX ? Number.parseFloat(spawnX) : undefined;
    const y = spawnY ? Number.parseFloat(spawnY) : undefined;
    onSpawn(team, x, y);
  };

  return (
    <div className="rounded-lg border border-gray-300 p-4 dark:border-gray-600">
      <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
        Spawn Tank
      </h3>

      <div className="mb-3 flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          data-testid="spawn-x"
          onChange={e => setSpawnX(e.target.value)}
          placeholder="Spawn X (optional)"
          type="number"
          value={spawnX}
        />
        <input
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          data-testid="spawn-y"
          onChange={e => setSpawnY(e.target.value)}
          placeholder="Spawn Y (optional)"
          type="number"
          value={spawnY}
        />
      </div>

      <div className="flex gap-2">
        <button
          className="flex-1 rounded bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
          data-testid="spawn-red-tank"
          onClick={() => handleSpawn('red')}
        >
          Spawn Red Tank
        </button>
        <button
          className="flex-1 rounded bg-blue-500 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-600"
          data-testid="spawn-blue-tank"
          onClick={() => handleSpawn('blue')}
        >
          Spawn Blue Tank
        </button>
      </div>
    </div>
  );
};

const GameEventLog = ({ events }: { events: GameEvent[] }) => (
  <div className="rounded-lg border border-gray-300 p-4 dark:border-gray-600">
    <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
      Game Events
    </h3>
    <div className="h-32 overflow-y-auto rounded bg-gray-50 p-2 text-xs dark:bg-gray-800">
      {events.length === 0 ? (
        <p className="text-gray-500">No events yet...</p>
      ) : (
        events
          .slice()
          .reverse()
          .map((event, idx) => (
            <div className="mb-1 text-gray-700 dark:text-gray-300" key={idx}>
              <span className="text-gray-500 dark:text-gray-400">
                [{new Date(event.ts).toLocaleTimeString()}]
              </span>{' '}
              <span className="font-mono">{event.type}</span>
              {Boolean(event.payload) && (
                <span className="text-gray-600 dark:text-gray-400">
                  {' '}
                  - {JSON.stringify(event.payload).slice(0, 100)}
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
    gameEvents,
    isConnected,
    moveTank,
    requestWorldState,
    spawnTank,
    tanksByTeam
  } = useTankGame();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6">
        <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
          Tank World
        </h1>
        <ConnectionStatus isConnected={isConnected} status={connectionStatus} />

        <button
          className="rounded bg-gray-500 px-3 py-1 text-sm text-white transition-colors hover:bg-gray-600"
          data-testid="refresh-world-state"
          onClick={requestWorldState}
        >
          Refresh World State
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TankList
          onMoveTank={moveTank}
          tanks={tanksByTeam.red}
          title={`Red Team (${tanksByTeam.red.length})`}
        />
        <TankList
          onMoveTank={moveTank}
          tanks={tanksByTeam.blue}
          title={`Blue Team (${tanksByTeam.blue.length})`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SpawnControls onSpawn={spawnTank} />
        <GameEventLog events={gameEvents} />
      </div>
    </div>
  );
};

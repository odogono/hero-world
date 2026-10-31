import { FormEvent, useCallback, useState } from 'react';

import { useGameNetwork } from '@helpers/network';

type TankRow = {
  hp?: number;
  id: number;
  team: 'red' | 'blue';
  vx?: number;
  vy?: number;
  x: number;
  y: number;
};

type ServerTank = {
  hp?: number;
  id: number;
  team: 'red' | 'blue';
  vx?: number;
  vy?: number;
  x?: number;
  y?: number;
};

type ServerMessage = {
  message?: string;
  tanks?: ServerTank[];
  type?: string;
};

export const GameDemo = () => {
  const {
    connect,
    disconnect,
    hello,
    lastMessage,
    messages,
    move,
    spawn,
    status
  } = useGameNetwork();

  const [team, setTeam] = useState<'red' | 'blue'>('red');
  const [spawnX, setSpawnX] = useState(0);
  const [spawnY, setSpawnY] = useState(0);
  const [moveId, setMoveId] = useState<number>(0);
  const [moveX, setMoveX] = useState<number>(10);
  const [moveY, setMoveY] = useState<number>(10);

  const parsed = (lastMessage?.json as ServerMessage | undefined) ?? null;

  const [tanks, setTanks] = useState<TankRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Derive state from each new message during render (instead of in an
  // effect) to avoid cascading re-renders.
  const [prevMessage, setPrevMessage] = useState(lastMessage);
  if (lastMessage !== prevMessage) {
    setPrevMessage(lastMessage);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      if (parsed.type === 'error') {
        setErrorMsg(parsed.message || 'Server reported an error.');
      } else if (
        parsed.type === 'world:snapshot' ||
        parsed.type === 'world:update'
      ) {
        setTanks(
          (parsed.tanks || []).map(t => ({
            hp: t.hp ?? 100,
            id: t.id,
            team: t.team,
            vx: Math.round((t.vx ?? 0) * 100) / 100,
            vy: Math.round((t.vy ?? 0) * 100) / 100,
            x: Math.round((t.x ?? 0) * 100) / 100,
            y: Math.round((t.y ?? 0) * 100) / 100
          }))
        );
      }
    }
  }

  const onSpawn = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const sx = Number.isFinite(spawnX) ? spawnX : 0;
      const sy = Number.isFinite(spawnY) ? spawnY : 0;
      setErrorMsg(null);
      spawn(team, sx, sy);
    },
    [spawn, team, spawnX, spawnY]
  );

  const onMove = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const id = Number.isFinite(moveId) ? moveId : Number.NaN;
      const mx = Number.isFinite(moveX) ? moveX : Number.NaN;
      const my = Number.isFinite(moveY) ? moveY : Number.NaN;
      if (
        !Number.isFinite(id) ||
        !Number.isFinite(mx) ||
        !Number.isFinite(my)
      ) {
        setErrorMsg('Enter valid numbers for id/x/y.');
        return;
      }
      setErrorMsg(null);
      move(id, mx, my);
    },
    [move, moveId, moveX, moveY]
  );

  return (
    <div
      className="w-full max-w-xl rounded border bg-white p-4 shadow-sm"
      data-testid="game-demo"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Game Demo</h2>
        <span className="text-sm text-gray-600" data-testid="status">
          status: {status}
        </span>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-50"
          data-testid="connect-btn"
          disabled={status === 'open' || status === 'connecting'}
          onClick={connect}
        >
          Connect
        </button>
        <button
          className="rounded bg-gray-600 px-3 py-1 text-white disabled:opacity-50"
          data-testid="disconnect-btn"
          disabled={status !== 'open' && status !== 'connecting'}
          onClick={disconnect}
        >
          Disconnect
        </button>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
          disabled={status !== 'open'}
          onClick={() => hello('Player')}
        >
          Hello
        </button>
      </div>

      {errorMsg && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <form className="mb-3 grid grid-cols-5 gap-2" onSubmit={onSpawn}>
        <select
          className="col-span-1 rounded border px-2 py-1 text-black"
          data-testid="spawn-team"
          onChange={e => setTeam(e.target.value as 'red' | 'blue')}
          value={team}
        >
          <option value="red">red</option>
          <option value="blue">blue</option>
        </select>
        <input
          className="col-span-1 rounded border px-2 py-1 text-black placeholder:text-gray-500"
          data-testid="spawn-x"
          onChange={e => setSpawnX(Number(e.target.value))}
          placeholder="x"
          type="number"
          value={spawnX}
        />
        <input
          className="col-span-1 rounded border px-2 py-1 text-black placeholder:text-gray-500"
          data-testid="spawn-y"
          onChange={e => setSpawnY(Number(e.target.value))}
          placeholder="y"
          type="number"
          value={spawnY}
        />
        <button
          className="col-span-2 rounded bg-black px-3 py-1 text-white disabled:opacity-50"
          data-testid="spawn-submit"
          disabled={status !== 'open'}
        >
          Spawn Tank
        </button>
      </form>

      <form className="mb-3 grid grid-cols-5 gap-2" onSubmit={onMove}>
        <input
          className="col-span-1 rounded border px-2 py-1 text-black placeholder:text-gray-500"
          data-testid="move-id"
          onChange={e => setMoveId(Number(e.target.value))}
          placeholder="id"
          type="number"
          value={moveId}
        />
        <input
          className="col-span-1 rounded border px-2 py-1 text-black placeholder:text-gray-500"
          data-testid="move-x"
          onChange={e => setMoveX(Number(e.target.value))}
          placeholder="x"
          type="number"
          value={moveX}
        />
        <input
          className="col-span-1 rounded border px-2 py-1 text-black placeholder:text-gray-500"
          data-testid="move-y"
          onChange={e => setMoveY(Number(e.target.value))}
          placeholder="y"
          type="number"
          value={moveY}
        />
        <button
          className="col-span-2 rounded bg-blue-700 px-3 py-1 text-white"
          data-testid="move-submit"
          disabled={status !== 'open'}
        >
          Move Tank
        </button>
      </form>

      <div className="mb-2 text-sm font-semibold">Tanks</div>
      <div className="mb-4 max-h-56 overflow-auto rounded border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-100 text-gray-700">
            <tr>
              <th className="px-2 py-1">ID</th>
              <th className="px-2 py-1">Team</th>
              <th className="px-2 py-1">X</th>
              <th className="px-2 py-1">Y</th>
              <th className="px-2 py-1">VX</th>
              <th className="px-2 py-1">VY</th>
              <th className="px-2 py-1">HP</th>
              <th className="px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tanks.length === 0 ? (
              <tr>
                <td className="px-2 py-2 text-gray-500" colSpan={8}>
                  No tanks yet — spawn one above.
                </td>
              </tr>
            ) : (
              tanks.map(t => (
                <tr className="odd:bg-white even:bg-gray-50" key={t.id}>
                  <td className="px-2 py-1">{t.id}</td>
                  <td className="px-2 py-1">{t.team}</td>
                  <td className="px-2 py-1">{t.x}</td>
                  <td className="px-2 py-1">{t.y}</td>
                  <td className="px-2 py-1">{t.vx}</td>
                  <td className="px-2 py-1">{t.vy}</td>
                  <td className="px-2 py-1">{t.hp}</td>
                  <td className="px-2 py-1">
                    <button
                      className="rounded bg-gray-800 px-2 py-0.5 text-xs text-white"
                      onClick={() => setMoveId(t.id)}
                      type="button"
                    >
                      Use ID
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-2 text-sm text-gray-700">Last update:</div>
      <pre
        className="mb-3 max-h-36 overflow-auto rounded bg-gray-100 p-2 text-xs text-black"
        data-testid="last-update"
      >
        {parsed ? JSON.stringify(parsed, null, 2) : '—'}
      </pre>

      <div className="mb-2 text-sm text-gray-700">Recent (latest 5):</div>
      <div className="max-h-48 overflow-auto rounded border bg-gray-50 p-2 text-xs text-black">
        {messages.slice(-5).map((m, i) => (
          <div className="mb-1" key={i}>
            <code>{m.raw}</code>
          </div>
        ))}
      </div>
    </div>
  );
};

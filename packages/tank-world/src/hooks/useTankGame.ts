import { useCallback, useEffect, useMemo, useState } from 'react';

import { useWebSocket } from './useWebSocket';

export type Tank = {
  hasActiveOrder: boolean;
  health: number;
  id: number;
  maxHealth: number;
  maxVelocityX: number;
  maxVelocityY: number;
  team: 'red' | 'blue';
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
};

export type GameEvent = {
  payload?: unknown;
  ts: number;
  type: string;
};

type GameMessage = GameEvent & {
  payload?: {
    id: number;
    tanks?: Tank[];
    team: 'red' | 'blue';
    x: number;
    y: number;
  };
  tankId?: number;
  team: 'red' | 'blue';
  x: number;
  y: number;
};

export const useTankGame = () => {
  const { lastMessage, messages, sendJson, status } = useWebSocket({
    url: 'ws://localhost:3001/ws' // Direct connection to backend server
  });
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [gameEvents, setGameEvents] = useState<GameEvent[]>([]);

  // Parse incoming messages
  // Derived during render (rather than in an effect) to avoid cascading
  // re-renders; runs once per new message.
  const [prevMessage, setPrevMessage] = useState(lastMessage);
  if (lastMessage !== prevMessage && lastMessage?.json) {
    setPrevMessage(lastMessage);
    const message = lastMessage.json as GameMessage;

    // Handle game events
    if (message.type?.startsWith('game:')) {
      setGameEvents(prev => [...prev, message]);

      switch (message.type) {
        case 'game:srv:spawned':
          // Tank spawned
          if (message.payload) {
            const newTank: Tank = {
              hasActiveOrder: false,
              health: 100,
              id: message.payload.id,
              maxHealth: 100,
              maxVelocityX: 50,
              maxVelocityY: 50,
              team: message.payload.team,
              velocityX: 0,
              velocityY: 0,
              x: message.payload.x,
              y: message.payload.y
            };
            setTanks(prev => [
              ...prev.filter(t => t.id !== newTank.id),
              newTank
            ]);
          }
          break;

        case 'game:world_state:response':
          // World state update
          if (message.payload?.tanks) {
            setTanks(message.payload.tanks);
          }
          break;

        case 'game:tank_spawned':
          // Direct tank spawn response
          if (message.tankId) {
            const newTank: Tank = {
              hasActiveOrder: false,
              health: 100,
              id: message.tankId,
              maxHealth: 100,
              maxVelocityX: 50,
              maxVelocityY: 50,
              team: message.team,
              velocityX: 0,
              velocityY: 0,
              x: message.x,
              y: message.y
            };
            setTanks(prev => [
              ...prev.filter(t => t.id !== newTank.id),
              newTank
            ]);
          }
          break;
      }
    }
  }

  const requestWorldState = useCallback(
    () =>
      sendJson({
        requestId: `${Date.now()}`,
        type: 'game:world_state'
      }),
    [sendJson]
  );

  // Request world state on connection
  useEffect(() => {
    if (status === 'open') {
      requestWorldState();
    }
  }, [status, requestWorldState]);

  const spawnTank = useCallback(
    (team: 'red' | 'blue', x?: number, y?: number) =>
      sendJson({
        team,
        type: 'game:spawn',
        x,
        y
      }),
    [sendJson]
  );

  const moveTank = useCallback(
    (tankId: number, targetX: number, targetY: number) =>
      sendJson({
        tankId,
        targetX,
        targetY,
        type: 'game:move'
      }),
    [sendJson]
  );

  const connectionStatus = useMemo(() => {
    switch (status) {
      case 'connecting':
        return 'Connecting...';
      case 'open':
        return 'Connected';
      case 'closing':
        return 'Disconnecting...';
      case 'closed':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  }, [status]);

  const tanksByTeam = useMemo(
    () => ({
      blue: tanks.filter(t => t.team === 'blue'),
      red: tanks.filter(t => t.team === 'red')
    }),
    [tanks]
  );

  return {
    // Connection
    connectionStatus,
    isConnected: status === 'open',

    // Game state
    gameEvents: gameEvents.slice(-50), // Keep last 50 events
    tanks,
    tanksByTeam,

    // Actions
    moveTank,
    requestWorldState,
    spawnTank
  };
};

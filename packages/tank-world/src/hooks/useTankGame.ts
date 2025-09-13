import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocket } from './useWebSocket';

export type Tank = {
  id: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  maxVelocityX: number;
  maxVelocityY: number;
  health: number;
  maxHealth: number;
  team: 'red' | 'blue';
  hasActiveOrder: boolean;
};

export type GameEvent = {
  type: string;
  payload?: any;
  ts: number;
};

export function useTankGame() {
  const { status, sendJson, messages, lastMessage } = useWebSocket({
    url: 'ws://localhost:3001/ws' // Direct connection to backend server
  });
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [gameEvents, setGameEvents] = useState<GameEvent[]>([]);

  // Parse incoming messages
  useEffect(() => {
    if (!lastMessage?.json) return;

    const message = lastMessage.json as any;
    
    // Handle game events
    if (message.type?.startsWith('game:')) {
      setGameEvents(prev => [...prev, message]);
      
      switch (message.type) {
        case 'game:srv:spawned':
          // Tank spawned
          if (message.payload) {
            const newTank: Tank = {
              id: message.payload.id,
              x: message.payload.x,
              y: message.payload.y,
              velocityX: 0,
              velocityY: 0,
              maxVelocityX: 50,
              maxVelocityY: 50,
              health: 100,
              maxHealth: 100,
              team: message.payload.team,
              hasActiveOrder: false
            };
            setTanks(prev => [...prev.filter(t => t.id !== newTank.id), newTank]);
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
              id: message.tankId,
              x: message.x,
              y: message.y,
              velocityX: 0,
              velocityY: 0,
              maxVelocityX: 50,
              maxVelocityY: 50,
              health: 100,
              maxHealth: 100,
              team: message.team,
              hasActiveOrder: false
            };
            setTanks(prev => [...prev.filter(t => t.id !== newTank.id), newTank]);
          }
          break;
      }
    }
  }, [lastMessage]);

  // Request world state on connection
  useEffect(() => {
    if (status === 'open') {
      requestWorldState();
    }
  }, [status]);

  const spawnTank = useCallback((team: 'red' | 'blue', x?: number, y?: number) => {
    return sendJson({
      type: 'game:spawn',
      team,
      x,
      y
    });
  }, [sendJson]);

  const moveTank = useCallback((tankId: number, targetX: number, targetY: number) => {
    return sendJson({
      type: 'game:move',
      tankId,
      targetX,
      targetY
    });
  }, [sendJson]);

  const requestWorldState = useCallback(() => {
    return sendJson({
      type: 'game:world_state',
      requestId: `${Date.now()}`
    });
  }, [sendJson]);

  const connectionStatus = useMemo(() => {
    switch (status) {
      case 'connecting': return 'Connecting...';
      case 'open': return 'Connected';
      case 'closing': return 'Disconnecting...';
      case 'closed': return 'Disconnected';
      default: return 'Unknown';
    }
  }, [status]);

  const tanksByTeam = useMemo(() => ({
    red: tanks.filter(t => t.team === 'red'),
    blue: tanks.filter(t => t.team === 'blue')
  }), [tanks]);

  return {
    // Connection
    connectionStatus,
    isConnected: status === 'open',
    
    // Game state
    tanks,
    tanksByTeam,
    gameEvents: gameEvents.slice(-50), // Keep last 50 events
    
    // Actions
    spawnTank,
    moveTank,
    requestWorldState
  };
}
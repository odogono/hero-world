export type TankEvents = {
  'cmd:move': { id: number; targetX: number; targetY: number };
  'health:changed': { health: number; id: number; maxHealth: number };

  'move:completed': { id: number; x: number; y: number };

  'move:started': {
    fromX: number;
    fromY: number;
    id: number;
    toX: number;
    toY: number;
  };
  'query:world_state': { requestId: number };

  'srv:spawned': {
    id: number;
    team: 'red' | 'blue';
    x: number;
    y: number;
  };

  'world_state:response': {
    requestId: number;
    tanks: {
      hasActiveOrder: boolean;
      health: number;
      id: number;
      maxVelocityX: number;
      maxVelocityY: number;
      team: 'red' | 'blue';
      velocityX: number;
      velocityY: number;
      x: number;
      y: number;
    }[];
  };
};

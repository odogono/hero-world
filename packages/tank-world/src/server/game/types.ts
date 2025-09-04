import { defineComponent } from 'odgn-ecs/component';
import z from 'zod';

export const positionComponent = defineComponent({
  name: 'position' as const,
  schema: {
    x: z.number(),
    y: z.number()
  }
});

export const velocityComponent = defineComponent({
  name: 'velocity' as const,
  schema: {
    speed: z.number().default(50),
    x: z.number(),
    y: z.number()
  }
});

export const healthComponent = defineComponent({
  name: 'health' as const,
  schema: {
    health: z.number(),
    maxHealth: z.number()
  }
});

export const teamComponent = defineComponent({
  name: 'team' as const,
  schema: {
    team: z.enum(['red', 'blue'])
  }
});

export const moveOrderComponent = defineComponent({
  name: 'moveOrder',
  schema: {
    createdAt: z.number(),
    isCompleted: z.boolean().default(false),
    target: z.number(),
    x: z.number(),
    y: z.number()
  }
});

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

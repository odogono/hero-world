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
    speed: z.number().default(1),
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

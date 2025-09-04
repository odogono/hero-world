import type { ExtractWorldComponents } from 'odgn-ecs';
import { createEntity } from 'odgn-ecs/entity';
import {
  eventComponent,
  scheduleEvent as scheduleEventECS
} from 'odgn-ecs/events';
import { createGameLoop } from 'odgn-ecs/system';
import { createWorld as createWorldECS } from 'odgn-ecs/world';

import {
  healthComponent,
  moveOrderComponent,
  positionComponent,
  teamComponent,
  velocityComponent
} from './components';
import { commandSystem } from './system/command';
import { movementSystem } from './system/movement';
import { notificationSystem } from './system/notification';

export type TankWorld = Awaited<ReturnType<typeof createWorld>>;
export type World = TankWorld['world'];
export type ScheduleEvent = TankWorld['scheduleEvent'];
export type Loop = TankWorld['loop'];

export const createWorld = async () => {
  const world = (await createWorldECS())
    .registerComponent(positionComponent)
    .registerComponent(velocityComponent)
    .registerComponent(healthComponent)
    .registerComponent(teamComponent)
    .registerComponent(moveOrderComponent)
    .registerComponent(eventComponent)
    .build();
  type Components = ExtractWorldComponents<typeof world>;
  const scheduleEvent = (
    type: string,
    payload: unknown,
    scheduledAt?: number
  ) => scheduleEventECS(world, type, payload, scheduledAt);

  const loop = createGameLoop(world, { execAdditional: { scheduleEvent } })
    .addSystem('notification', notificationSystem, { priority: 10 })
    .addSystem('command', commandSystem, { priority: 100 })
    .addSystem('movement', movementSystem, { priority: 90 });

  const run = () => {};
  const stop = () => {};

  return { loop, scheduleEvent, world };
};

export const spawnTank = (
  { scheduleEvent, world }: TankWorld,
  team: 'red' | 'blue',
  x: number,
  y: number
) => {
  const tank = createEntity(world, {
    health: { health: 100, maxHealth: 100 },
    position: { x, y },
    team: { team },
    velocity: { speed: 50, x: 0, y: 0 }
  });

  scheduleEvent('srv:spawned', {
    id: tank.id,
    team,
    x,
    y
  });

  return tank;
};

export const issueMoveOrder = (
  { scheduleEvent }: TankWorld,
  id: number,
  targetX: number,
  targetY: number
) => {
  scheduleEvent('cmd:move', { id, targetX, targetY });
};

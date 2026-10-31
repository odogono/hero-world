import type { ExtractWorldComponents } from 'odgn-ecs';
import { createEntity } from 'odgn-ecs/entity';
import {
  eventComponent,
  scheduleEvent as scheduleEventECS
} from 'odgn-ecs/events';
import { createGameLoop } from 'odgn-ecs/system';
import { createWorld as createWorldECS } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

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

const log = createLog('server/world');

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

  let tick = 0;
  const loop = createGameLoop(world, { execAdditional: { scheduleEvent } })
    .addSystem('notification', notificationSystem, { priority: 10 })
    .addSystem('command', commandSystem, { priority: 100 })
    .addSystem('movement', movementSystem, { priority: 90 });

  const update = (dtMs: number) => {
    loop.update(dtMs);
    tick += 1;
    return tick;
  };

  const getTick = () => tick;

  const snapshot = () => serializeSnapshot(world, tick);

  return { getTick, loop, scheduleEvent, snapshot, update, world };
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

  log.debug('spawnTank', tank.id, team, x, y);

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

type ComponentRow = {
  eid: number;
  health: number;
  team: 'red' | 'blue';
  x: number;
  y: number;
};
type ComponentRows = Record<string, ComponentRow[]>;

// Basic serializer for broadcasting state to clients
export const serializeSnapshot = (world: World, tick: number) => {
  // Use DB dump as a source of truth; map to compact tank state
  const json = world.db.saveToJSON() as { components?: ComponentRows };
  const comps: ComponentRows = json.components ?? {};

  const positions = new Map<number, { x: number; y: number }>();
  const velocities = new Map<number, { x: number; y: number }>();
  const teams = new Map<number, 'red' | 'blue'>();
  const health = new Map<number, { health: number }>();

  for (const row of comps.position ?? []) {
    positions.set(row.eid, { x: row.x, y: row.y });
  }
  for (const row of comps.velocity ?? []) {
    velocities.set(row.eid, { x: row.x ?? 0, y: row.y ?? 0 });
  }
  for (const row of comps.team ?? []) {
    teams.set(row.eid, row.team);
  }
  for (const row of comps.health ?? []) {
    health.set(row.eid, { health: row.health });
  }

  const tanks: Array<{
    hp: number;
    id: number;
    team: 'red' | 'blue';
    vx: number;
    vy: number;
    x: number;
    y: number;
  }> = [];

  for (const [eid, pos] of positions.entries()) {
    const team = teams.get(eid);
    if (!team) {
      continue;
    } // only broadcast entities that are tanks
    const vel = velocities.get(eid) ?? { x: 0, y: 0 };
    const hp = health.get(eid)?.health ?? 100;
    tanks.push({ hp, id: eid, team, vx: vel.x, vy: vel.y, x: pos.x, y: pos.y });
  }

  return { tanks, tick, type: 'world:snapshot' as const };
};

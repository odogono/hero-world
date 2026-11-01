import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import { DIRECTIONS, OPPOSITE_DIRECTIONS } from '../commands/verbs';
import type { MuaComponents } from '../coms';
import { findExitByDirection } from '../queries/room';

const log = createLog('exits');

type ExitSpec = {
  /** A door the exit goes through; the way back goes through it too */
  door?: EntityId;
  /** Said when someone tries an exit that leads nowhere */
  msg?: string;
  /** Don't make the way back */
  oneWay?: boolean;
  to?: EntityId;
};

const toSpec = (value: unknown): ExitSpec | undefined => {
  if (typeof value === 'number') {
    return { to: value };
  }
  if (typeof value === 'object' && value !== null) {
    return value as ExitSpec;
  }
  return undefined;
};

const addExit = (
  world: World<MuaComponents>,
  roomId: EntityId,
  dir: string,
  { door, msg, to }: ExitSpec
) => {
  // an exit already there wins, whether declared as an entity or made earlier
  if (findExitByDirection(world, roomId, dir)) {
    return false;
  }
  world.create({ location: { in: roomId }, portal: { dir, door, msg, to } });
  world.flush();
  return true;
};

/**
 * Turns every room's `exits` component into exit entities, making the way
 * back too unless an exit is `oneWay`. Exits that already exist are left
 * alone, so this is safe to run again.
 */
export const expandExits = (world: World<MuaComponents>) => {
  const rooms = world.queryAll({ with: ['exits'] });
  // ways back wait until every room's own exits exist, so an exit a room
  // declares always wins over one made as another room's way back
  const waysBack: [EntityId, string, ExitSpec][] = [];
  let count = 0;

  for (const room of rooms) {
    const exits = room.exits as Record<string, unknown>;
    for (const dir of DIRECTIONS) {
      const spec = toSpec(exits[dir]);
      if (!spec) {
        continue;
      }
      if (addExit(world, room.id, dir, spec)) {
        count++;
      }
      const back = OPPOSITE_DIRECTIONS[dir];
      if (spec.to !== undefined && spec.to !== null && !spec.oneWay && back) {
        waysBack.push([spec.to, back, { door: spec.door, to: room.id }]);
      }
    }
  }

  for (const [roomId, dir, spec] of waysBack) {
    if (addExit(world, roomId, dir, spec)) {
      count++;
    }
  }

  log.info(`Made ${count} exits`);
};

import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import { getEntity } from '../queries/entity';
import { createMuaSystem } from '../systems/create-mua-system';

/** World time 0 as an Instant, for Scripts: the start of 2000 (UTC) */
const EPOCH_MS = Date.UTC(2000, 0, 1);

/**
 * Game time, advanced by each tick of the game loop and kept on the system
 * actor's `clock`, so it survives a restart and tests can drive it exactly.
 */
export type WorldClock = {
  /** World time as epoch microseconds, for the Script Group's Pump */
  micros: () => bigint;
  /** World time in milliseconds */
  now: () => number;
  /** Advances the clock by each tick's time; runs before every other system */
  system: ReturnType<typeof createMuaSystem>;
};

export const createWorldClock = (
  world: World<MuaComponents>,
  systemId: EntityId
): WorldClock => {
  let now = getEntity(world, systemId, ['clock'])?.clock.now ?? 0;

  const system = createMuaSystem(
    ({ deltaTime, entity }) => {
      if (entity.id !== systemId) {
        return;
      }
      now += deltaTime;
      entity.clock = { now };
    },
    { frequency: 1, priority: 50, with: ['clock'] }
  );

  return {
    micros: () => BigInt(EPOCH_MS + Math.floor(now)) * 1000n,
    now: () => now,
    system
  };
};

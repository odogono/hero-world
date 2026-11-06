import type { Components } from '../types';
import type { World } from '../world';

/**
 * How a System runs inside a Frame: a function over the World, run every
 * Frame, or once every `every` of World time. It works through the World,
 * whose queries return change-tracked proxies, so it sees what earlier
 * FrameSystems in the same Frame changed.
 *
 * Unlike the store's `System` (`store/system.ts`), which reads committed
 * rows and records its runs in `ecs_systems` as a Step does, a FrameSystem
 * keeps when it last ran in memory.
 */
export type FrameSystem<W> = {
  every?: number;
  name: string;
  run: (world: W, frameMs: number) => void;
};

export type FrameTiming = {
  /** ms in the end-of-Frame flush */
  flush: number;
  /** ms in each FrameSystem that ran, by name */
  systems: Record<string, number>;
  /** ms for the whole Frame */
  total: number;
};

export type FrameLoopOptions = {
  /**
   * What happens to the changes the World records for change sets
   * (`takeChanges`). `'discard'`, the default, clears them every
   * `discardEvery` Frames, since a loop takes none and they would otherwise
   * pile up. `'keep'` leaves them for a caller that takes them itself.
   */
  changes?: 'discard' | 'keep';
  /** Frames between clearing recorded changes; 60 by default */
  discardEvery?: number;
  /** World time each Frame advances by; 1000 / 60 by default */
  frameMs?: number;
};

/**
 * A free-running game loop (ADR 0019): each `frame()` advances World time
 * by `frameMs`, runs every due FrameSystem in order, and flushes once, so a
 * Frame is one commit. The caller decides when to call it, as a host owns
 * the wall clock for a Step.
 */
export const createFrameLoop = <
  TComponents extends Components,
  W extends World<TComponents>
>(
  world: W,
  systems: readonly FrameSystem<W>[],
  {
    changes = 'discard',
    discardEvery = 60,
    frameMs = 1000 / 60
  }: FrameLoopOptions = {}
) => {
  const lastRun = new Map<string, number>();
  let frames = 0;

  const due = (system: FrameSystem<W>, now: number) => {
    if (system.every === undefined) {
      return true;
    }
    const last = lastRun.get(system.name);
    // Like a store System, one first seen runs one interval later
    if (last === undefined) {
      lastRun.set(system.name, now);
      return false;
    }
    if (now < last + system.every) {
      return false;
    }
    lastRun.set(system.name, now);
    return true;
  };

  const frame = (): FrameTiming => {
    const start = performance.now();
    world.advanceTime(frameMs);
    const now = world.time;
    const timing: FrameTiming = { flush: 0, systems: {}, total: 0 };

    for (const system of systems) {
      if (due(system, now)) {
        const t0 = performance.now();
        system.run(world, frameMs);
        timing.systems[system.name] = performance.now() - t0;
      }
    }

    const t1 = performance.now();
    world.flush();
    frames += 1;
    if (changes === 'discard' && frames % discardEvery === 0) {
      world.db.exec('DELETE FROM temp.ecs_changes');
    }
    const end = performance.now();
    timing.flush = end - t1;
    timing.total = end - start;
    return timing;
  };

  return { frame, frameMs };
};

import type { World } from 'odgn-ecs/world';

/**
 * Logic run once per Frame, or once every `every` ms of World time.
 * It works through the World (queries return change-tracked proxies), so it
 * sees what earlier FrameSystems in the same Frame changed.
 */
export type FrameSystem<W> = {
  every?: number;
  name: string;
  run: (world: W, frameMs: number) => void;
};

export type FrameTiming = {
  /** ms spent in the end-of-Frame flush */
  flush: number;
  /** ms spent in each FrameSystem, by name */
  systems: Record<string, number>;
  /** ms for the whole Frame */
  total: number;
};

/**
 * A free-running game loop: each `frame()` advances World time by
 * `frameMs`, runs every due FrameSystem in order, and flushes once, so a
 * Frame is one commit.
 *
 * It doesn't use the store's `dueSystems`/`runSystem`: those read their
 * entities straight from the store, so they don't see changes still pending
 * in the World, and they write `ecs_systems` on every run. That fits a Step,
 * not a Frame. When each FrameSystem last ran is kept in memory here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any World
export const createFrameLoop = <W extends World<any>>(
  world: W,
  systems: readonly FrameSystem<W>[],
  { frameMs = 1000 / 60 }: { frameMs?: number } = {}
) => {
  const lastRun = new Map<string, number>();

  const frame = (): FrameTiming => {
    const start = performance.now();
    world.advanceTime(frameMs);
    const now = world.time;
    const timing: FrameTiming = { flush: 0, systems: {}, total: 0 };

    for (const system of systems) {
      if (system.every !== undefined) {
        const last = lastRun.get(system.name);
        if (last === undefined) {
          lastRun.set(system.name, now);
          continue;
        }
        if (now < last + system.every) {
          continue;
        }
        lastRun.set(system.name, now);
      }
      const t0 = performance.now();
      system.run(world, frameMs);
      timing.systems[system.name] = performance.now() - t0;
    }

    const t1 = performance.now();
    world.flush();
    const end = performance.now();
    timing.flush = end - t1;
    timing.total = end - start;
    return timing;
  };

  return { frame, frameMs };
};

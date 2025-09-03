import { createLog } from 'odgn-helpers/log';

import { deleteEntity } from '@entity';
import type { EventSystem } from '@events';
import type { Components, World } from '@types';

import type {
  GameLoop,
  SystemFunction,
  SystemOptions,
  SystemPerformance,
  SystemRegistration
} from './types';

const log = createLog('game-loop');

type GameLoopOptions = {
  logErrors?: boolean;
};

/**
 * Utility function to log system performance
 */
export const logSystemPerformance = (
  gameLoop: GameLoop<any>,
  threshold = 16.67
): void => {
  const perf = gameLoop.getPerformance();
  const slowSystems = perf.filter(p => p.averageExecutionTime > threshold);

  if (slowSystems.length > 0) {
    log.warn(`Systems exceeding ${threshold}ms average execution time:`);
    slowSystems.forEach(system => {
      log.warn(
        `  ${system.id}: ${system.averageExecutionTime.toFixed(2)}ms avg, ${system.lastExecutionTime.toFixed(2)}ms last`
      );
    });
  }

  const totalTime = perf.reduce((sum, p) => sum + p.lastExecutionTime, 0);
  log.debug(`Total system execution time: ${totalTime.toFixed(2)}ms`);
};

/**
 * Creates an event-aware game loop that collects events for each system before execution
 */
export const createGameLoop = <TComponents extends Components>(
  world: World<TComponents>,
  eventSystem?: EventSystem,
  options: GameLoopOptions = {}
): GameLoop<TComponents> => {
  const { logErrors = false } = options;
  const systems = new Map<string, SystemRegistration<TComponents>>();
  const perfMap = new Map<string, SystemPerformance>();
  let frameCount = 0;

  const addSystem = (
    id: string,
    fn: SystemFunction<TComponents>,
    options: SystemOptions = {}
  ): GameLoop<TComponents> => {
    if (systems.has(id)) {
      log.warn(`System '${id}' already exists, replacing`);
    }

    const systemRegistration: SystemRegistration<TComponents> = {
      enabled: options.enabled ?? true,
      fn,
      frameCount: 0,
      id,
      options: {
        enabled: options.enabled ?? true,
        frequency: options.frequency ?? 1,
        priority: options.priority ?? 50
      }
    };

    systems.set(id, systemRegistration);

    perfMap.set(id, {
      averageExecutionTime: 0,
      executionCount: 0,
      id,
      lastExecutionTime: 0,
      totalExecutionTime: 0
    });

    log.debug(
      `Added event-aware system '${id}' with priority ${systemRegistration.options.priority}`
    );
    return gameLoop;
  };

  const removeSystem = (id: string): GameLoop<TComponents> => {
    if (!systems.has(id)) {
      log.warn(`System '${id}' does not exist`);
      return gameLoop;
    }

    systems.delete(id);
    perfMap.delete(id);
    log.debug(`Removed system '${id}'`);
    return gameLoop;
  };

  const enableSystem = (id: string): GameLoop<TComponents> => {
    const system = systems.get(id);
    if (!system) {
      log.warn(`System '${id}' does not exist`);
      return gameLoop;
    }

    system.enabled = true;
    log.debug(`Enabled system '${id}'`);
    return gameLoop;
  };

  const disableSystem = (id: string): GameLoop<TComponents> => {
    const system = systems.get(id);
    if (!system) {
      log.warn(`System '${id}' does not exist`);
      return gameLoop;
    }

    system.enabled = false;
    log.debug(`Disabled system '${id}'`);
    return gameLoop;
  };

  const getSortedSystems = (): SystemRegistration<TComponents>[] =>
    Array.from(systems.values()).sort(
      (a, b) => b.options.priority - a.options.priority
    );

  const update = (deltaTime: number): void => {
    frameCount++;
    const sortedSystems = getSortedSystems();

    // Pre-collect frame events if supported, so each system sees the same set
    let frameEvents:
      | Array<{
          entity: { id: number | undefined; world: World<TComponents> };
          payload: any;
          type: string;
        }>
      | null = null;
    const canCollectAll =
      eventSystem && typeof (eventSystem as any).collectAllEvents === 'function';
    if (canCollectAll) {
      try {
        frameEvents = (eventSystem as any).collectAllEvents();
      } catch (err) {
        log.error('Error collecting frame events:', err);
        frameEvents = [];
      }
    }

    // console.log('[GameLoop][update] sortedSystems', sortedSystems);

    // Track entities to delete after all systems run
    const toDelete: number[] = [];

    for (const system of sortedSystems) {
      if (!system.enabled) {
        // console.log('[GameLoop][update] system disabled', system.id);
        continue;
      }

      if (frameCount % system.options.frequency !== 0) {
        // console.log('[GameLoop][update] system not running', system.id);
        continue;
      }

      const startTime = Date.now();

      try {
        // Collect events for this system.
        // Prefer new API that collects all events; fall back to older
        // collectEventsForSystem(systemId) if provided by a mock/legacy impl.
        let events:
          | Array<{
              entity: { id: number | undefined; world: World<TComponents> };
              payload: any;
              type: string;
            }>
          | [] = [];

        if (frameEvents !== null) {
          // Broadcast mode only; systems can filter by event type themselves
          events = frameEvents;
        }

        // Execute system with events, disabling flush to prevent double flushing
        system.fn(world, deltaTime, events, { flush: false });

        // Queue processed event entities for deletion
        if (events.length > 0) {
          for (const event of events) {
            const { id } = event.entity;
            if (typeof id === 'number') {
              toDelete.push(id);
            }
          }
        }

        const perf = perfMap.get(system.id);

        if (perf) {
          const executionTime = Date.now() - startTime;
          perf.lastExecutionTime = executionTime;
          perf.totalExecutionTime += executionTime;
          perf.executionCount++;
          perf.averageExecutionTime =
            perf.totalExecutionTime / perf.executionCount;
        }
      } catch (error) {
        // if (logErrors) {
        log.error(`System '${system.id}' threw an error:`, error);
        // }
      }
    }

    // Perform deletions once per frame and flush once
    try {
      if (toDelete.length > 0) {
        for (const id of toDelete) {
          // Delete in the same world
          deleteEntity({ id, world });
        }
      }
      // Flush to persist any changes made by systems or event deletions
      world.flush();
    } catch (error) {
      // Match per-system error handling behavior
      log.error(`End-of-frame flush threw an error:`, error);
    }
  };

  const getPerformance = (): SystemPerformance[] =>
    Array.from(perfMap.values()).sort(
      (a, b) => b.lastExecutionTime - a.lastExecutionTime
    );

  const getSystems = (): SystemRegistration<TComponents>[] =>
    getSortedSystems();

  const gameLoop: GameLoop<TComponents> = {
    addSystem,
    disableSystem,
    enableSystem,
    getPerformance,
    getSystems,
    removeSystem,
    update
  };

  return gameLoop;
};

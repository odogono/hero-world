import { createLog } from 'odgn-helpers/log';

import type { Components } from '../types';
import { World } from '../world';
import type {
  GameLoop,
  System,
  SystemOptions,
  SystemPerformance,
  SystemRegistration
} from './types';

const log = createLog('game-loop');

type GameLoopOptions = {
  execAdditional?: object;
  /**
   * Rethrow an error from a system or the end-of-frame flush instead of
   * logging it and carrying on. Turn it on in tests, where a logged error
   * otherwise leaves the test to fail later for another reason, or pass.
   */
  throwErrors?: boolean;
};

/**
 * Utility function to log system performance
 */
export const logSystemPerformance = <T extends Components>(
  gameLoop: GameLoop<T>,
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
  options: GameLoopOptions = {}
): GameLoop<TComponents> => {
  const { execAdditional = {}, throwErrors = false } = options;
  const systems = new Map<string, SystemRegistration<TComponents>>();
  const perfMap = new Map<string, SystemPerformance>();
  let frameCount = 0;

  const addSystem = (
    id: string,
    anySystem: System<TComponents> | System<Components>,
    options?: SystemOptions<TComponents>
  ): GameLoop<TComponents> => {
    // a system made without a world type works on any world
    const system = anySystem as System<TComponents>;
    if (systems.has(id)) {
      log.warn(`System '${id}' already exists, replacing`);
    }

    const allOptions = { ...system, ...options };

    const { enabled = true, exec, frequency = 1, priority = 50 } = allOptions;

    const systemRegistration: SystemRegistration<TComponents> = {
      enabled,
      frameCount: 0,
      id,
      options: {
        enabled,
        frequency,
        priority
      },
      system
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

    // console.log('[GameLoop][update] sortedSystems', sortedSystems);

    // Track entities to delete after all systems run
    // const toDelete: number[] = [];

    for (const system of sortedSystems) {
      if (!system.enabled) {
        // console.log('[GameLoop][update] system disabled', system.id);
        continue;
      }

      if (frameCount % system.options.frequency !== 0) {
        // console.log('[GameLoop][update] system not running', system.id);
        continue;
      }

      const startTime = performance.now();

      try {
        // Execute system with events, disabling flush to prevent double flushing
        system.system.exec({
          ...execAdditional,
          deltaTime,
          flushOnExec: false,
          world
        });

        const perf = perfMap.get(system.id);

        if (perf) {
          const executionTime = performance.now() - startTime;
          perf.lastExecutionTime = executionTime;
          perf.totalExecutionTime += executionTime;
          perf.executionCount++;
          perf.averageExecutionTime =
            perf.totalExecutionTime / perf.executionCount;
        }
      } catch (error) {
        if (throwErrors) {
          throw error;
        }
        log.error(`System '${system.id}' threw an error:`, error);
      }
    }

    // Perform deletions once per frame and flush once
    try {
      // Flush to persist any changes made by systems or event deletions
      world.flush();
    } catch (error) {
      if (throwErrors) {
        throw error;
      }
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

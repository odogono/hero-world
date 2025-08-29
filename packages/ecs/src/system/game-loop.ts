import { createLog } from 'odgn-helpers';

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

/**
 * Creates a game loop for executing systems in priority order with performance tracking
 */
export const createGameLoop = <TComponents extends Components>(
  world: World<TComponents>
): GameLoop<TComponents> => {
  const systems = new Map<string, SystemRegistration<TComponents>>();
  const performance = new Map<string, SystemPerformance>();
  let frameCount = 0;

  /**
   * Adds a system to the game loop
   */
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

    // Initialize performance tracking
    performance.set(id, {
      averageExecutionTime: 0,
      executionCount: 0,
      id,
      lastExecutionTime: 0,
      totalExecutionTime: 0
    });

    log.debug(
      `Added system '${id}' with priority ${systemRegistration.options.priority}`
    );
    return gameLoop;
  };

  /**
   * Removes a system from the game loop
   */
  const removeSystem = (id: string): GameLoop<TComponents> => {
    if (!systems.has(id)) {
      log.warn(`System '${id}' does not exist`);
      return gameLoop;
    }

    systems.delete(id);
    performance.delete(id);
    log.debug(`Removed system '${id}'`);
    return gameLoop;
  };

  /**
   * Enables a system
   */
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

  /**
   * Disables a system
   */
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

  /**
   * Gets systems sorted by priority (highest first)
   */
  const getSortedSystems = (): SystemRegistration<TComponents>[] =>
    Array.from(systems.values()).sort(
      (a, b) => b.options.priority - a.options.priority
    );

  /**
   * Executes all enabled systems in priority order
   */
  const update = (deltaTime: number): void => {
    frameCount++;
    const sortedSystems = getSortedSystems();

    for (const system of sortedSystems) {
      if (!system.enabled) {
        continue;
      }

      // Check if system should run this frame based on frequency
      if (frameCount % system.options.frequency !== 0) {
        continue;
      }

      const startTime = Date.now();

      try {
        // Call system without events (legacy compatibility)
        system.fn(world, deltaTime, []);

        // Update performance metrics
        const executionTime = Date.now() - startTime;
        const perf = performance.get(system.id)!;

        perf.lastExecutionTime = executionTime;
        perf.totalExecutionTime += executionTime;
        perf.executionCount++;
        perf.averageExecutionTime =
          perf.totalExecutionTime / perf.executionCount;
      } catch (error) {
        log.error(`System '${system.id}' threw an error:`, error);
        // Continue executing other systems even if one fails
      }
    }
  };

  /**
   * Gets performance data for all systems
   */
  const getPerformance = (): SystemPerformance[] =>
    Array.from(performance.values()).sort(
      (a, b) => b.lastExecutionTime - a.lastExecutionTime
    );

  /**
   * Gets all system registrations
   */
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
export const createEventAwareGameLoop = <TComponents extends Components>(
  world: World<TComponents>,
  eventSystem: EventSystem
): GameLoop<TComponents> => {
  const systems = new Map<string, SystemRegistration<TComponents>>();
  const performance = new Map<string, SystemPerformance>();
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

    performance.set(id, {
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
    performance.delete(id);
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

    for (const system of sortedSystems) {
      if (!system.enabled) {
        continue;
      }

      if (frameCount % system.options.frequency !== 0) {
        continue;
      }

      const startTime = Date.now();

      try {
        // Collect events for this system
        const events = eventSystem.collectEventsForSystem(system.id);

        // Execute system with events
        system.fn(world, deltaTime, events);

        const executionTime = Date.now() - startTime;
        const perf = performance.get(system.id)!;

        perf.lastExecutionTime = executionTime;
        perf.totalExecutionTime += executionTime;
        perf.executionCount++;
        perf.averageExecutionTime =
          perf.totalExecutionTime / perf.executionCount;
      } catch (error) {
        log.error(`System '${system.id}' threw an error:`, error);
      }
    }
  };

  const getPerformance = (): SystemPerformance[] =>
    Array.from(performance.values()).sort(
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

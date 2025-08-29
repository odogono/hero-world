import { describe, expect, test } from 'bun:test';

import { createWorld } from '@world';

import { DatabaseType } from '../../db';
import {
  createGameLoop,
  createSystem,
  logSystemPerformance
} from '../game-loop';

const createTestWorld = async () =>
  await createWorld({ dbType: DatabaseType.BUN });

describe('GameLoop', () => {
  test('should create empty game loop', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    expect(gameLoop).toBeDefined();
    expect(gameLoop.getSystems()).toHaveLength(0);
    expect(gameLoop.getPerformance()).toHaveLength(0);
  });

  test('should add system with default options', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem((world, deltaTime) => {
      // Test system that does nothing
    });

    gameLoop.addSystem('test-system', testSystem);

    const systems = gameLoop.getSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0].id).toBe('test-system');
    expect(systems[0].options.priority).toBe(50); // default priority
    expect(systems[0].options.enabled).toBe(true);
    expect(systems[0].options.frequency).toBe(1);
    expect(systems[0].enabled).toBe(true);
  });

  test('should add system with custom options', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem((world, deltaTime) => {});

    gameLoop.addSystem('test-system', testSystem, {
      enabled: false,
      frequency: 5,
      priority: 100
    });

    const systems = gameLoop.getSystems();
    expect(systems[0].options.priority).toBe(100);
    expect(systems[0].options.enabled).toBe(false);
    expect(systems[0].options.frequency).toBe(5);
    expect(systems[0].enabled).toBe(false);
  });

  test('should sort systems by priority (highest first)', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const system1 = createSystem(() => {});
    const system2 = createSystem(() => {});
    const system3 = createSystem(() => {});

    gameLoop
      .addSystem('low-priority', system1, { priority: 10 })
      .addSystem('high-priority', system2, { priority: 100 })
      .addSystem('mid-priority', system3, { priority: 50 });

    const systems = gameLoop.getSystems();
    expect(systems).toHaveLength(3);
    expect(systems[0].id).toBe('high-priority');
    expect(systems[1].id).toBe('mid-priority');
    expect(systems[2].id).toBe('low-priority');
  });

  test('should remove system', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(() => {});
    gameLoop.addSystem('test-system', testSystem);

    expect(gameLoop.getSystems()).toHaveLength(1);
    expect(gameLoop.getPerformance()).toHaveLength(1);

    gameLoop.removeSystem('test-system');

    expect(gameLoop.getSystems()).toHaveLength(0);
    expect(gameLoop.getPerformance()).toHaveLength(0);
  });

  test('should enable and disable systems', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(() => {});
    gameLoop.addSystem('test-system', testSystem);

    expect(gameLoop.getSystems()[0].enabled).toBe(true);

    gameLoop.disableSystem('test-system');
    expect(gameLoop.getSystems()[0].enabled).toBe(false);

    gameLoop.enableSystem('test-system');
    expect(gameLoop.getSystems()[0].enabled).toBe(true);
  });

  test('should execute systems in priority order', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const executionOrder: string[] = [];

    const system1 = createSystem(() => {
      executionOrder.push('system1');
    });
    const system2 = createSystem(() => {
      executionOrder.push('system2');
    });
    const system3 = createSystem(() => {
      executionOrder.push('system3');
    });

    gameLoop
      .addSystem('system1', system1, { priority: 10 })
      .addSystem('system2', system2, { priority: 100 })
      .addSystem('system3', system3, { priority: 50 });

    gameLoop.update(16.67);

    expect(executionOrder).toEqual(['system2', 'system3', 'system1']);
  });

  test('should pass world and deltaTime to systems', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    let receivedWorld: any;
    let receivedDeltaTime: number;

    const testSystem = createSystem((w, dt) => {
      receivedWorld = w;
      receivedDeltaTime = dt;
    });

    gameLoop.addSystem('test-system', testSystem);
    gameLoop.update(16.67);

    expect(receivedWorld).toBe(world);
    expect(receivedDeltaTime).toBe(16.67);
  });

  test('should not execute disabled systems', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    let systemExecuted = false;

    const testSystem = createSystem(() => {
      systemExecuted = true;
    });

    gameLoop.addSystem('test-system', testSystem, { enabled: false });
    gameLoop.update(16.67);

    expect(systemExecuted).toBe(false);
  });

  test('should respect system frequency', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
    });

    // System should run every 3 frames
    gameLoop.addSystem('test-system', testSystem, { frequency: 3 });

    // Frame 1 - should not run (1 % 3 !== 0)
    gameLoop.update(16.67);
    expect(executionCount).toBe(0);

    // Frame 2 - should not run (2 % 3 !== 0)
    gameLoop.update(16.67);
    expect(executionCount).toBe(0);

    // Frame 3 - should run (3 % 3 === 0)
    gameLoop.update(16.67);
    expect(executionCount).toBe(1);

    // Frame 4 - should not run
    gameLoop.update(16.67);
    expect(executionCount).toBe(1);

    // Frame 6 - should run again
    gameLoop.update(16.67);
    gameLoop.update(16.67);
    expect(executionCount).toBe(2);
  });

  test('should track system performance', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const slowSystem = createSystem(() => {
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait for ~10ms
      }
    });

    gameLoop.addSystem('slow-system', slowSystem);

    // Execute system multiple times
    gameLoop.update(16.67);
    gameLoop.update(16.67);
    gameLoop.update(16.67);

    const performance = gameLoop.getPerformance();
    expect(performance).toHaveLength(1);

    const perf = performance[0];
    expect(perf.id).toBe('slow-system');
    expect(perf.executionCount).toBe(3);
    expect(perf.lastExecutionTime).toBeGreaterThan(0);
    expect(perf.averageExecutionTime).toBeGreaterThan(0);
    expect(perf.totalExecutionTime).toBeGreaterThan(0);
    expect(perf.averageExecutionTime).toBe(
      perf.totalExecutionTime / perf.executionCount
    );
  });

  test('should continue executing other systems if one throws error', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    let system1Executed = false;
    let system3Executed = false;

    const system1 = createSystem(() => {
      system1Executed = true;
    });

    const system2 = createSystem(() => {
      throw new Error('System error');
    });

    const system3 = createSystem(() => {
      system3Executed = true;
    });

    gameLoop
      .addSystem('system1', system1, { priority: 100 })
      .addSystem('system2', system2, { priority: 50 })
      .addSystem('system3', system3, { priority: 10 });

    // Should not throw, and other systems should still execute
    expect(() => gameLoop.update(16.67)).not.toThrow();

    expect(system1Executed).toBe(true);
    expect(system3Executed).toBe(true);
  });

  test('should replace existing system with same id', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    let system1Executed = false;
    let system2Executed = false;

    const system1 = createSystem(() => {
      system1Executed = true;
    });

    const system2 = createSystem(() => {
      system2Executed = true;
    });

    gameLoop.addSystem('test-system', system1);
    gameLoop.addSystem('test-system', system2); // Should replace system1

    expect(gameLoop.getSystems()).toHaveLength(1);

    gameLoop.update(16.67);

    expect(system1Executed).toBe(false);
    expect(system2Executed).toBe(true);
  });

  test('should handle non-existent system operations gracefully', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    // Should not throw errors
    expect(() => gameLoop.removeSystem('non-existent')).not.toThrow();
    expect(() => gameLoop.enableSystem('non-existent')).not.toThrow();
    expect(() => gameLoop.disableSystem('non-existent')).not.toThrow();
  });

  test('should return performance sorted by last execution time', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const fastSystem = createSystem(() => {
      // Very fast system
    });

    const slowSystem = createSystem(() => {
      // Simulate slower system
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait
      }
    });

    gameLoop
      .addSystem('fast-system', fastSystem)
      .addSystem('slow-system', slowSystem);

    gameLoop.update(16.67);

    const performance = gameLoop.getPerformance();
    expect(performance).toHaveLength(2);

    // Should be sorted by lastExecutionTime (descending)
    expect(performance[0].lastExecutionTime).toBeGreaterThanOrEqual(
      performance[1].lastExecutionTime
    );
  });
});

describe('createSystem helper', () => {
  test('should create system function', () => {
    const system = createSystem((world, deltaTime) => {
      // Test system
    });

    expect(typeof system).toBe('function');
  });
});

describe('logSystemPerformance', () => {
  test('should log slow systems', async () => {
    const world = (await createTestWorld()).build();
    const gameLoop = createGameLoop(world);

    const slowSystem = createSystem(() => {
      const start = Date.now();
      while (Date.now() - start < 20) {
        // Simulate 20ms execution time
      }
    });

    gameLoop.addSystem('slow-system', slowSystem);
    gameLoop.update(16.67);

    // Should not throw
    expect(() => logSystemPerformance(gameLoop, 10)).not.toThrow();
  });
});

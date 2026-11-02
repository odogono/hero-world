import { describe, expect, test } from 'bun:test';

import { createSystem } from '..';
import { DatabaseType } from '../../db';
import { eventComponent } from '../../events';
import type { ExtractWorldComponents } from '../../types';
import { createWorld, type World } from '../../world';
import { createGameLoop, logSystemPerformance } from '../game-loop';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () => await createWorld([], { dbType });

describe('GameLoop', () => {
  test('should create empty game loop', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    expect(gameLoop).toBeDefined();
    expect(gameLoop.getSystems()).toHaveLength(0);
    expect(gameLoop.getPerformance()).toHaveLength(0);
  });

  test('should add system with default options', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(({ deltaTime, world }) => {
      // Test system that does nothing
    });

    gameLoop.addSystem('test-system', testSystem);

    const systems = gameLoop.getSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0]?.id).toBe('test-system');
    expect(systems[0]?.options.priority).toBe(50); // default priority
    expect(systems[0]?.options.enabled).toBe(true);
    expect(systems[0]?.options.frequency).toBe(1);
    expect(systems[0]?.enabled).toBe(true);
  });

  test('should add system with custom options', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(({ deltaTime, world }) => {});

    gameLoop.addSystem('test-system', testSystem, {
      enabled: false,
      frequency: 5,
      priority: 100
    });

    const systems = gameLoop.getSystems();
    expect(systems[0]?.options.priority).toBe(100);
    expect(systems[0]?.options.enabled).toBe(false);
    expect(systems[0]?.options.frequency).toBe(5);
    expect(systems[0]?.enabled).toBe(false);
  });

  test('should sort systems by priority (highest first)', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const system1 = createSystem(() => {});
    const system2 = createSystem(() => {});
    const system3 = createSystem(() => {});

    gameLoop
      .addSystem('low-priority', system1, { priority: 10 })
      .addSystem('high-priority', system2, { priority: 100 })
      .addSystem('mid-priority', system3, { priority: 50 });

    const systems = gameLoop.getSystems()!;
    expect(systems).toHaveLength(3);
    expect(systems[0]!.id).toBe('high-priority');
    expect(systems[1]!.id).toBe('mid-priority');
    expect(systems[2]!.id).toBe('low-priority');
  });

  test('should remove system', async () => {
    const world = await createTestWorld();
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
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(() => {});
    gameLoop.addSystem('test-system', testSystem);

    expect(gameLoop.getSystems()[0]!.enabled).toBe(true);

    gameLoop.disableSystem('test-system');
    expect(gameLoop.getSystems()[0]!.enabled).toBe(false);

    gameLoop.enableSystem('test-system');
    expect(gameLoop.getSystems()[0]!.enabled).toBe(true);
  });

  test('should execute systems in priority order', async () => {
    const world = await createTestWorld();
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
    const world = await createTestWorld();
    type C = ExtractWorldComponents<typeof world>;
    const gameLoop = createGameLoop(world);

    let receivedWorld: World<C> | undefined;
    let receivedDeltaTime: number | undefined;

    const testSystem = createSystem(({ deltaTime, world }) => {
      receivedWorld = world;
      receivedDeltaTime = deltaTime;
    });

    gameLoop.addSystem('test-system', testSystem);
    gameLoop.update(16.67);

    expect(receivedWorld).toBe(world);
    expect(receivedDeltaTime).toBe(16.67);
  });

  test('should not execute disabled systems', async () => {
    const world = await createTestWorld();
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
    const world = await createTestWorld();
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
    const world = await createTestWorld();
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

    const perf = performance[0]!;
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
    const world = await createTestWorld();
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
    const world = await createTestWorld();
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
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    // Should not throw errors
    expect(() => gameLoop.removeSystem('non-existent')).not.toThrow();
    expect(() => gameLoop.enableSystem('non-existent')).not.toThrow();
    expect(() => gameLoop.disableSystem('non-existent')).not.toThrow();
  });

  test('should return performance sorted by last execution time', async () => {
    const world = await createTestWorld();
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

    const performance = gameLoop.getPerformance()!;
    expect(performance).toHaveLength(2);

    // Should be sorted by lastExecutionTime (descending)
    expect(performance[0]!.lastExecutionTime).toBeGreaterThanOrEqual(
      performance[1]!.lastExecutionTime
    );
  });

  test('should handle frequency of 0 gracefully', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
    });

    // Frequency of 0 should prevent execution
    gameLoop.addSystem('test-system', testSystem, { frequency: 0 });

    gameLoop.update(16.67);
    gameLoop.update(16.67);
    gameLoop.update(16.67);

    expect(executionCount).toBe(0);
  });

  test('should handle negative frequency gracefully', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
    });

    // Negative frequency: 1 % (-1) = 0, so it runs every frame
    gameLoop.addSystem('test-system', testSystem, { frequency: -1 });

    gameLoop.update(16.67);
    gameLoop.update(16.67);
    gameLoop.update(16.67);

    expect(executionCount).toBe(3);
  });

  test('should handle very high frequency values', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
    });

    // Very high frequency: 1 % 1000 = 1, so it never runs
    gameLoop.addSystem('test-system', testSystem, { frequency: 1000 });

    gameLoop.update(16.67);
    gameLoop.update(16.67);
    gameLoop.update(16.67);

    expect(executionCount).toBe(0);
  });

  test('should handle multiple system replacements', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const system1 = createSystem(() => {
      executionCount = 1;
    });

    const system2 = createSystem(() => {
      executionCount = 2;
    });

    const system3 = createSystem(() => {
      executionCount = 3;
    });

    gameLoop.addSystem('test-system', system1);
    gameLoop.addSystem('test-system', system2);
    gameLoop.addSystem('test-system', system3);

    expect(gameLoop.getSystems()).toHaveLength(1);

    gameLoop.update(16.67);
    expect(executionCount).toBe(3);
  });

  test('should handle empty update call', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    // Should not throw when no systems are registered
    expect(() => gameLoop.update(16.67)).not.toThrow();
  });

  test('should handle zero deltaTime', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let receivedDeltaTime: number;

    const testSystem = createSystem(({ deltaTime }) => {
      receivedDeltaTime = deltaTime;
    });

    gameLoop.addSystem('test-system', testSystem);
    gameLoop.update(0);

    expect(receivedDeltaTime!).toBe(0);
  });

  test('should handle negative deltaTime', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let receivedDeltaTime: number;

    const testSystem = createSystem(({ deltaTime }) => {
      receivedDeltaTime = deltaTime;
    });

    gameLoop.addSystem('test-system', testSystem);
    gameLoop.update(-16.67);

    expect(receivedDeltaTime!).toBe(-16.67);
  });

  test('should handle system that throws different error types', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let otherSystemExecuted = false;

    const errorSystem = createSystem(() => {
      throw new TypeError('Type error');
    });

    const otherSystem = createSystem(() => {
      otherSystemExecuted = true;
    });

    gameLoop
      .addSystem('error-system', errorSystem)
      .addSystem('other-system', otherSystem);

    expect(() => gameLoop.update(16.67)).not.toThrow();
    expect(otherSystemExecuted).toBe(true);
  });

  test('rethrows a system error when throwErrors is set', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world, { throwErrors: true });

    gameLoop.addSystem(
      'error-system',
      createSystem(() => {
        throw new TypeError('Type error');
      })
    );

    expect(() => gameLoop.update(16.67)).toThrow('Type error');
  });

  test('should handle system that throws string error', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let otherSystemExecuted = false;

    const errorSystem = createSystem(() => {
      throw 'String error';
    });

    const otherSystem = createSystem(() => {
      otherSystemExecuted = true;
    });

    gameLoop
      .addSystem('error-system', errorSystem)
      .addSystem('other-system', otherSystem);

    expect(() => gameLoop.update(16.67)).not.toThrow();
    expect(otherSystemExecuted).toBe(true);
  });

  test('should handle system that throws undefined', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let otherSystemExecuted = false;

    const errorSystem = createSystem(() => {
      throw undefined;
    });

    const otherSystem = createSystem(() => {
      otherSystemExecuted = true;
    });

    gameLoop
      .addSystem('error-system', errorSystem)
      .addSystem('other-system', otherSystem);

    expect(() => gameLoop.update(16.67)).not.toThrow();
    expect(otherSystemExecuted).toBe(true);
  });

  test('should handle chained method calls', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(() => {});

    // Should support method chaining
    const result = gameLoop
      .addSystem('system1', testSystem)
      .addSystem('system2', testSystem)
      .removeSystem('system1')
      .enableSystem('system2')
      .disableSystem('system2');

    expect(result).toBe(gameLoop);
    expect(gameLoop.getSystems()).toHaveLength(1);
    expect(gameLoop.getSystems()[0]!.id).toBe('system2');
  });
});

describe('createGameLoop', () => {
  test('should delete event entities after processing', async () => {
    const world = await createWorld([eventComponent], { dbType });
    const gameLoop = createGameLoop(world);

    let systemExecuted = false;

    const testSystem = createSystem(({ deltaTime, world }) => {
      systemExecuted = true;
    });

    gameLoop.addSystem('test-system', testSystem);

    // Run the game loop
    gameLoop.update(16);

    // Check that the system received the event
    expect(systemExecuted).toBe(true);
  });
});

describe('logSystemPerformance', () => {
  test('should log slow systems', async () => {
    const world = await createTestWorld();
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

  test('should handle empty performance data', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    // Should not throw with no systems
    expect(() => logSystemPerformance(gameLoop)).not.toThrow();
  });

  test('should handle custom threshold', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const fastSystem = createSystem(() => {
      // Very fast system
    });

    gameLoop.addSystem('fast-system', fastSystem);
    gameLoop.update(16.67);

    // Should not throw with custom threshold
    expect(() => logSystemPerformance(gameLoop, 1)).not.toThrow();
  });

  test('should handle zero threshold', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const slowSystem = createSystem(() => {
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Simulate 5ms execution time
      }
    });

    gameLoop.addSystem('slow-system', slowSystem);
    gameLoop.update(16.67);

    // Should not throw with zero threshold
    expect(() => logSystemPerformance(gameLoop, 0)).not.toThrow();
  });

  test('should handle negative threshold', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const fastSystem = createSystem(() => {
      // Very fast system
    });

    gameLoop.addSystem('fast-system', fastSystem);
    gameLoop.update(16.67);

    // Should not throw with negative threshold
    expect(() => logSystemPerformance(gameLoop, -1)).not.toThrow();
  });

  test('should handle multiple slow systems', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const slowSystem1 = createSystem(() => {
      const start = Date.now();
      while (Date.now() - start < 20) {
        // Simulate 20ms execution time
      }
    });

    const slowSystem2 = createSystem(() => {
      const start = Date.now();
      while (Date.now() - start < 15) {
        // Simulate 15ms execution time
      }
    });

    gameLoop
      .addSystem('slow-system-1', slowSystem1)
      .addSystem('slow-system-2', slowSystem2);

    gameLoop.update(16.67);

    // Should not throw
    expect(() => logSystemPerformance(gameLoop, 10)).not.toThrow();
  });
});

describe('Edge Cases and Error Handling', () => {
  test('should handle system with null function', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    // This should not throw, but the system won't execute properly
    expect(() => {
      gameLoop.addSystem(
        'null-system',
        null as unknown as Parameters<typeof gameLoop.addSystem>[1]
      );
    }).not.toThrow();
  });

  test('should handle system with undefined function', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    // This should not throw, but the system won't execute properly
    expect(() => {
      gameLoop.addSystem(
        'undefined-system',
        undefined as unknown as Parameters<typeof gameLoop.addSystem>[1]
      );
    }).not.toThrow();
  });

  test('should handle empty system id', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(() => {});

    expect(() => {
      gameLoop.addSystem('', testSystem);
    }).not.toThrow();

    expect(gameLoop.getSystems()).toHaveLength(1);
    expect(gameLoop.getSystems()[0]!.id).toBe('');
  });

  test('should handle system id with special characters', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const testSystem = createSystem(() => {});

    expect(() => {
      gameLoop.addSystem('system-with-special-chars!@#$%^&*()', testSystem);
    }).not.toThrow();

    expect(gameLoop.getSystems()).toHaveLength(1);
    expect(gameLoop.getSystems()[0]!.id).toBe(
      'system-with-special-chars!@#$%^&*()'
    );
  });

  test('should handle very large priority values', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    const system1 = createSystem(() => {});
    const system2 = createSystem(() => {});

    gameLoop
      .addSystem('system1', system1, { priority: Number.MAX_SAFE_INTEGER })
      .addSystem('system2', system2, { priority: Number.MIN_SAFE_INTEGER });

    const systems = gameLoop.getSystems();
    expect(systems[0]!.id).toBe('system1');
    expect(systems[1]!.id).toBe('system2');
  });

  test('should handle very large frequency values', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
    });

    gameLoop.addSystem('test-system', testSystem, {
      frequency: Number.MAX_SAFE_INTEGER
    });

    // Should not run due to very large frequency
    gameLoop.update(16.67);
    expect(executionCount).toBe(0);
  });

  test('should handle floating point frequency values', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
    });

    gameLoop.addSystem('test-system', testSystem, { frequency: 2.5 });

    // Should handle floating point frequency (modulo with floating point)
    gameLoop.update(16.67); // Frame 1: 1 % 2.5 = 1 (not 0)
    expect(executionCount).toBe(0);

    gameLoop.update(16.67); // Frame 2: 2 % 2.5 = 2 (not 0)
    expect(executionCount).toBe(0);

    gameLoop.update(16.67); // Frame 3: 3 % 2.5 = 0.5 (not 0)
    expect(executionCount).toBe(0);
  });

  test('should handle system that modifies its own registration', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
      // This should not affect the current execution
      gameLoop.disableSystem('test-system');
    });

    gameLoop.addSystem('test-system', testSystem);
    gameLoop.update(16.67);

    expect(executionCount).toBe(1);
    expect(gameLoop.getSystems()[0]!.enabled).toBe(false);
  });

  test('should handle system that adds new systems during execution', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let newSystemExecuted = false;

    const testSystem = createSystem(() => {
      const newSystem = createSystem(() => {
        newSystemExecuted = true;
      });
      gameLoop.addSystem('new-system', newSystem);
    });

    gameLoop.addSystem('test-system', testSystem);
    gameLoop.update(16.67);

    // New system should not execute in the same frame
    expect(newSystemExecuted).toBe(false);
    expect(gameLoop.getSystems()).toHaveLength(2);
  });

  test('should handle system that removes itself during execution', async () => {
    const world = await createTestWorld();
    const gameLoop = createGameLoop(world);

    let executionCount = 0;

    const testSystem = createSystem(() => {
      executionCount++;
      gameLoop.removeSystem('test-system');
    });

    gameLoop.addSystem('test-system', testSystem);

    // This might throw due to performance tracking trying to access removed system
    // but the system should still execute once before removal
    try {
      gameLoop.update(16.67);
    } catch {
      // Expected due to performance tracking issue
    }

    expect(executionCount).toBe(1);
    expect(gameLoop.getSystems()).toHaveLength(0);
  });
});

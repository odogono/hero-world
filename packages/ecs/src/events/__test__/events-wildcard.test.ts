import { describe, expect, test } from 'bun:test';

import { createWorld, flush } from '@/world';
import { DatabaseType } from '@db';
import { eventComponent, getEvents, scheduleEvent } from '@events';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () => await createWorld([eventComponent], { dbType });

describe('EventSystem wildcards', () => {
  test('should get events by wildcard type patterns', async () => {
    const world = await createTestWorld();

    // Schedule various event types
    scheduleEvent(world, 'enemy-spawn', { id: 1 });
    scheduleEvent(world, 'enemy-die', { id: 2 });
    scheduleEvent(world, 'boss1', { phase: 1 });
    scheduleEvent(world, 'boss12', { phase: 2 });
    flush(world);

    // '*' should match all types (no type filter)
    const all = getEvents(world, '*');
    expect(all).toHaveLength(4);

    // Pattern with * should match both enemy-* events
    const enemies = getEvents(world, 'enemy-*');
    expect(enemies).toHaveLength(2);
    expect(enemies.every(e => e.type.startsWith('enemy-'))).toBe(true);

    // Mixed list with pattern and literal, '?' matches single char
    const mixed = getEvents(world, ['enemy-*', 'boss?']);
    // boss? should match boss1 but not boss12
    const mixedTypes = mixed.map(e => e.type).sort();
    expect(mixedTypes).toEqual(['boss1', 'enemy-die', 'enemy-spawn'].sort());
  });

  test('should collect events by wildcard type patterns', async () => {
    const world = await createTestWorld();

    scheduleEvent(world, 'warn-1', { level: 1 });
    scheduleEvent(world, 'warn-2', { level: 2 });
    scheduleEvent(world, 'error-a', { code: 'A' });
    scheduleEvent(world, 'info', {});
    flush(world);

    // Collect with wildcard pattern
    const collectedWarns = getEvents(world, 'warn-*');
    expect(collectedWarns).toHaveLength(2);
    expect(collectedWarns.every(e => e.type.startsWith('warn-'))).toBe(true);

    // Flush to persist processed marks
    flush(world);

    // Collect with list including '?' single-char pattern
    const collectedMixed = getEvents(world, ['error-?', 'info']);
    const types = collectedMixed.map(e => e.type).sort();
    expect(types).toEqual(['error-a', 'info'].sort());
  });
});

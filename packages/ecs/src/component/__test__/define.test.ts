import { describe, expect, it, test } from 'bun:test';

import { DatabaseType } from '@db';
import { createWorld } from '@world';

import { s } from '../builder';
import { defineComponent } from '../define';

const worldOpts = {
  clearExisting: true,
  dbType: (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN,
  path: ':memory:'
};

describe('Component Definition', () => {
  test('should reject duplicate component definitions', async () => {
    const defA = defineComponent({
      id: 'test',
      schema: {
        name: s.string()
      }
    });

    const defB = defineComponent({
      id: 'test',
      schema: {
        name: s.string()
      }
    });

    expect(createWorld([defA, defB], worldOpts)).rejects.toThrow(
      /Duplicate component definition for 'test'/
    );
  });

  test('should accept component definitions with different schema', async () => {
    const defA = defineComponent({
      id: 'test',
      schema: {
        name: s.string()
      }
    });
    // despite having the same id, the schema is different
    // so this ends up overwriting the first one
    const defB = defineComponent({
      id: 'test',
      schema: {
        name: s.string(),
        uuid: s.uuid()
      }
    });
    expect(createWorld([defA, defB], worldOpts)).resolves.toBeTruthy();
  });

  test('should accept component definitions with different schema', async () => {
    const defA = defineComponent({
      id: 'test',
      schema: {
        name: s.string()
      }
    });
    // despite having the same id, the schema is different
    // so this ends up overwriting the first one
    const defB = defineComponent({
      id: 'test',
      schema: {
        name: s.string(),
        uuid: s.uuid()
      }
    });
    const opts = { ...worldOpts, allowRedefineDefinitions: false };
    expect(createWorld([defA, defB], opts)).rejects.toThrow(
      /Duplicate component definition for 'test'/
    );
  });

  it('should allow schema properties with reserved sqlite keywords', () => {
    const def = defineComponent({
      id: 'test',
      schema: {
        from: s.string(),
        groupBy: s.string(),
        having: s.string(),
        in: s.entityId(),
        limit: s.string(),
        offset: s.string(),
        orderBy: s.string(),
        select: s.string(),
        where: s.string()
      }
    });
    expect(createWorld([def], worldOpts)).resolves.toBeTruthy();
  });
});

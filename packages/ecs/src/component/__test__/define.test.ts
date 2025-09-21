import { describe, expect, test } from 'bun:test';

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
});

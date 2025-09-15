/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test } from 'bun:test';

import { datetime, defineComponent, email, float, string } from '../next';

describe('Component (next)', () => {
  test('should define a component', () => {
    const def = defineComponent({
      id: 'user',
      schema: {
        email: email().unique(),
        name: string()
      }
    });

    expect(def).toMatchObject({
      columns: [
        { isUnique: true, name: 'email', optional: false, type: 'email' },
        { name: 'name', optional: false, type: 'string' }
      ],
      id: 'user',
      tableName: 'tbl_user'
    });
  });

  test('schema properties can have default values', () => {
    const def = defineComponent({
      id: 'user',
      schema: {
        name: string().default('John Doe'),
        height: float().default(1.0),
        createdAt: datetime().default()
      }
    });

    expect(def).toMatchObject({
      columns: [
        { default: 'John Doe', name: 'name', optional: false, type: 'string' },
        { default: 1.0, name: 'height', optional: false, type: 'float' },
        {
          default: 'current_timestamp',
          name: 'createdAt',
          optional: false,
          type: 'datetime'
        }
      ],
      id: 'user',
      tableName: 'tbl_user'
    });
  });
});

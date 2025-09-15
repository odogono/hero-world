/* eslint-disable perfectionist/sort-objects */

import { describe, expect, expectTypeOf, setSystemTime, test } from 'bun:test';

import {
  createComponent,
  datetime,
  defineComponent,
  email,
  float,
  int,
  string,
  type InferComponentType
} from '../next';

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

  test('instantiate a component with defaults', () => {
    const def = defineComponent({
      id: 'user',
      schema: {
        name: string().default('John Doe'),
        email: email()
      }
    });

    type defType = InferComponentType<typeof def>;

    const com = createComponent(def, { email: 'test@test.com' });

    expectTypeOf(com).toEqualTypeOf<{ email: string; name: string }>();
    expectTypeOf(com).toEqualTypeOf<defType>();

    expect(com).toMatchObject({
      email: 'test@test.com',
      name: 'John Doe'
    });
  });
  test('instantiate a component with optional fields', () => {
    const def = defineComponent({
      id: 'vitals',
      schema: {
        age: int().optional(),
        height: float().optional()
      }
    });

    expect(def).toMatchObject({
      columns: [
        { name: 'age', optional: true, type: 'int' },
        { name: 'height', optional: true, type: 'float' }
      ],
      id: 'vitals',
      tableName: 'tbl_vitals'
    });

    type defType = InferComponentType<typeof def>;

    const com = createComponent(def, { age: 25 });

    type expectedType = { age?: number; height?: number };

    expectTypeOf(com).toEqualTypeOf<expectedType>();
    expectTypeOf(com).toEqualTypeOf<defType>();

    expect(com).toMatchObject({
      age: 25
    });

    const ex: defType = {
      age: 25,
      height: 1.8
    };
  });

  test('instantiate a component with date defaults', () => {
    setSystemTime(new Date('1974-09-05T16:00:00Z').getTime());

    const def = defineComponent({
      id: 'user',
      schema: {
        name: string().default('John Doe'),
        createdAt: datetime().default()
      }
    });

    type defTypeNew = InferComponentType<typeof def>;

    const com = createComponent(def);

    expect(com).toMatchObject({
      name: 'John Doe',
      createdAt: new Date()
    });

    expectTypeOf(com).toEqualTypeOf<defTypeNew>();
    setSystemTime();
  });
});

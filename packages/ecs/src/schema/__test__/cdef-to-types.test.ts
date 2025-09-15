/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test } from 'bun:test';

import type { CDef } from '@types';

import { cdefToTypes } from '../cdef-to-types';

describe('CDef to TypeScript types (text output)', () => {
  test('generates pasteable TS types with auto fields', () => {
    const cdef: CDef = {
      id: 'user',
      tableName: 'tbl_users',
      columns: [
        { name: 'id', type: 'pk' },
        { name: 'name', type: 'string', optional: false }
      ]
    };

    const code = cdefToTypes(cdef);

    expect(code).toContain('export type UserComponent = {');
    // auto fields first
    expect(code).toContain('id?: number;');
    expect(code).toContain('eid?: number;');
    expect(code).toContain('createdAt: string;');
    expect(code).toContain('updatedAt: string;');
    // explicit columns (id is deduped, name remains required)
    expect(code).toContain('name: string;');

    // bottom types
    expect(code).toContain('export type AllComponents =');
    expect(code).toContain('| UserComponent;');
    expect(code).toContain('export type Components = {');
    expect(code).toContain('user: UserComponent;');
  });

  test('maps types, defaults, and optionality', () => {
    const cdef: CDef = {
      id: 'user',
      columns: [
        { name: 'name', type: 'string', optional: false },
        { name: 'email', type: 'email', isUnique: true, optional: false },
        { name: 'age', type: 'int' },
        { name: 'height', type: 'float', default: 1.0 },
        { name: 'isActive', type: 'boolean', default: true },
        {
          name: 'favourites',
          type: 'int',
          optional: false,
          foreignKey: 'tbl_favourites'
        },
        { name: 'type', type: 'enum', values: ['admin', 'user'] },
        {
          name: 'status',
          type: 'enum',
          values: ['active', 'inactive'],
          isIndexed: true
        },
        { name: 'last_login', type: 'datetime', default: 'current_timestamp' },
        { name: 'birth_date', type: 'date' },
        { name: 'prefs', type: 'json' },
        { name: 'tags', type: 'array' }
      ]
    };

    const code = cdefToTypes(cdef);

    // required vs optional
    expect(code).toContain('name: string;');
    expect(code).toContain('email: string;');
    expect(code).toContain('age?: number;');
    expect(code).toContain('height: number;');
    expect(code).toContain('isActive: boolean;');
    expect(code).toContain('favourites: number;');
    // enums become literal unions and are required
    expect(code).toContain("type: 'admin' | 'user';");
    expect(code).toContain("status: 'active' | 'inactive';");
    // date/datetime mapping
    expect(code).toContain('lastLogin: string;');
    expect(code).toContain('birthDate?: Date;');
    // json/array mapping
    expect(code).toContain('prefs?: unknown;');
    expect(code).toContain('tags?: unknown[];');
  });

  test('does not duplicate auto id when provided explicitly', () => {
    const cdef: CDef = {
      id: 'thing',
      columns: [
        { name: 'id', type: 'pk' },
        { name: 'title', type: 'string' }
      ]
    };

    const code = cdefToTypes(cdef);

    // count occurrences of top-level id field definition (should be 1)
    const idLines = code
      .split('\n')
      .filter(line => line.trim().startsWith('id?: '));
    expect(idLines.length).toBe(1);
  });

  test('handles multiple component definitions', () => {
    const userDef: CDef[] = [
      {
        id: 'user',
        columns: [
          { name: 'id', type: 'pk' },
          { name: 'name', type: 'string' }
        ]
      }
    ];
    const describableDef: CDef[] = [
      {
        id: 'describable',
        columns: [
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' }
        ]
      }
    ];

    const result = cdefToTypes([userDef, describableDef]);

    expect(result).toContain('export type UserComponent = {');
    expect(result).toContain('export type DescribableComponent = {');

    // union and mapping
    expect(result).toContain('export type AllComponents =');
    expect(result).toContain('| UserComponent');
    expect(result).toContain('| DescribableComponent');
    expect(result).toContain('export type Components = {');
    expect(result).toContain('user: UserComponent;');
    expect(result).toContain('describable: DescribableComponent;');
  });
});

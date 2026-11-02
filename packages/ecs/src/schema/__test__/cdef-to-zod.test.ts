/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test } from 'bun:test';

import type { CDef } from '../../types';
import { cdefToZod } from '../cdef-to-zod';

describe('CDef to Zod schema (text output)', () => {
  test('generates pasteable Zod schema with tableName', () => {
    const cdef: CDef = {
      id: 'user',
      hash: '',
      tableName: 'tbl_users',
      columns: [
        { name: 'id', type: 'pk' },
        { name: 'name', type: 'string', optional: false }
      ]
    };

    const code = cdefToZod(cdef);

    expect(code).toContain("import { z } from 'zod'");
    expect(code).toContain('export const UserSchema = z.object({');
    // auto fields first
    expect(code).toContain('id: z.number().int().optional()');
    expect(code).toContain('eid: z.number().int().optional()');
    expect(code).toContain(
      'createdAt: z.iso.datetime().default(() => new Date().toISOString())'
    );
    expect(code).toContain(
      'updatedAt: z.iso.datetime().default(() => new Date().toISOString())'
    );
    // explicit columns (id is deduped, name remains)
    expect(code).toContain('name: z.string()');
    // table name metadata
    expect(code).toContain(").meta({ name: 'tbl_users' });");
  });

  test('maps types, defaults, and metadata', () => {
    const cdef: CDef = {
      id: 'user',
      hash: '',
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
        { name: 'birth_date', type: 'date' }
      ]
    };

    const code = cdefToZod(cdef);

    // schema name and table name
    expect(code).toContain('export const UserSchema = z.object({');
    expect(code).toContain(").meta({ name: 'tbl_user' });");

    // field mappings
    expect(code).toContain('name: z.string()');
    expect(code).toContain('email: z.string().email().meta({');
    expect(code).toContain('"unique":true');
    expect(code).toContain('age: z.number().int().optional()');
    expect(code).toContain('height: z.number().default(1)');
    expect(code).toContain('isActive: z.boolean().default(true)');
    expect(code).toContain('favourites: z.number().int()');
    expect(code).toContain("type: z.enum(['admin', 'user'])");
    expect(code).toContain("status: z.enum(['active', 'inactive']).meta({");
    expect(code).toContain('"index":true');
    expect(code).toContain(
      'lastLogin: z.iso.datetime().default(() => new Date().toISOString())'
    );
    expect(code).toContain('birthDate: z.date().optional()');
  });

  test('does not duplicate auto id when provided explicitly', () => {
    const cdef: CDef = {
      id: 'thing',
      hash: '',
      columns: [
        { name: 'id', type: 'pk' },
        { name: 'title', type: 'string' }
      ]
    };

    const code = cdefToZod(cdef);

    // count occurrences of top-level id field definition (should be 1)
    const idLines = code
      .split('\n')
      .filter(line => line.trim().startsWith('id: '));
    expect(idLines.length).toBe(1);
  });

  test('handles multiple component definitions', () => {
    const userDef: CDef[] = [
      {
        id: 'user',
        hash: '',
        columns: [
          { name: 'id', type: 'pk' },
          { name: 'name', type: 'string' }
        ]
      }
    ];
    const describableDef: CDef[] = [
      {
        id: 'describable',
        hash: '',
        columns: [
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' }
        ]
      }
    ];

    const result = cdefToZod([userDef, describableDef], {
      includeImports: false
    });

    expect(result).toContain('export const UserSchema = z.object({');
    expect(result).toContain('export const DescribableSchema = z.object({');
    expect(result).not.toContain(`import { z } from 'zod'`);
  });
});

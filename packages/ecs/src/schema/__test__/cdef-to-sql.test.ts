/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test } from 'bun:test';

import { cdefToSql } from '../cdef-to-sql';
import type { CDef } from '../types';

describe('Component Definitions to SQL', () => {
  test('should convert a component definition to a SQL table', () => {
    const cdef: CDef = {
      id: 'user',
      tableName: 'tbl_users',
      columns: [
        { name: 'id', type: 'pk' },
        { name: 'name', type: 'string' }
      ]
    };

    const result = cdefToSql(cdef);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_users');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NULL');
  });

  test('should convert a component definition to a SQL table', () => {
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
        { name: 'lastLogin', type: 'datetime', default: 'current_timestamp' },
        { name: 'birthDate', type: 'date' }
      ]
    };

    const result = cdefToSql(cdef);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('eid INTEGER NULL');
    expect(result.sql).toContain(
      'FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE'
    );
    expect(result.sql).toContain('name TEXT NOT NULL');
    expect(result.sql).toContain('email TEXT NOT NULL UNIQUE');
    expect(result.sql).toContain('age INTEGER NULL');
    expect(result.sql).toContain('height REAL NOT NULL DEFAULT 1.0');
    expect(result.sql).toContain('is_active INTEGER NOT NULL DEFAULT 1');
    expect(result.sql).toContain('favourites TEXT NOT NULL');
    expect(result.sql).toContain(
      'FOREIGN KEY (favourites) REFERENCES tbl_favourites (id) ON DELETE CASCADE'
    );
    expect(result.sql).toContain('type TEXT NOT NULL');
    expect(result.sql).toContain('status TEXT NOT NULL');
    expect(result.sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_tbl_user_status ON tbl_user (status)'
    );
    expect(result.sql).toContain('birth_date TEXT NULL');
    expect(result.sql).toContain(
      'last_login DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
    expect(result.sql).toContain(
      'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
    expect(result.sql).toContain(
      'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );

    const rollback = cdefToSql(cdef, { up: false, down: true });

    expect(rollback.sql).not.toContain('CREATE TABLE IF NOT EXISTS tbl_user');
    expect(rollback.sql).toContain('DROP TABLE IF EXISTS tbl_user');
    expect(rollback.sql).toContain('DROP INDEX IF EXISTS idx_tbl_user_status');
  });

  test('multiple component definitions', () => {
    const userCdef: CDef[] = [
      {
        id: 'user',
        tableName: 'tbl_user',
        columns: [
          { name: 'id', type: 'pk' },
          { name: 'name', type: 'string' }
        ]
      }
    ];
    const describableCdef: CDef[] = [
      {
        id: 'describable',
        columns: [
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' }
        ]
      }
    ];

    const result = cdefToSql([userCdef, describableCdef], {
      includeEntity: true,
      up: true,
      down: true
    });

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_entity');
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user');
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_describable');

    expect(result.sql).toContain('DROP TABLE IF EXISTS tbl_entity');
    expect(result.sql).toContain('DROP TABLE IF EXISTS tbl_user');
    expect(result.sql).toContain('DROP TABLE IF EXISTS tbl_describable');
  });
});

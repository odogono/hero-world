/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test } from 'bun:test';

import type { CDef } from '../../types';
import {
  cdefToSql,
  cdefToSqlInsert,
  cdefToSqlSelect,
  cdefToSqlSelectWhere
} from '../cdef-to-sql';

describe('Component Definitions to SQL', () => {
  test('should convert a component definition to a SQL table', () => {
    const cdef: CDef = {
      id: 'user',
      hash: '1234567',
      columns: [{ name: 'name', type: 'string' }]
    };

    const result = cdefToSql(cdef);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user_1234567');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NULL');
  });

  test('should convert a component definition to a SQL table', () => {
    const cdef: CDef = {
      id: 'user',
      hash: '1234567',
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

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user_1234567');
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
    expect(result.sql).toContain('favourites INTEGER NOT NULL');
    expect(result.sql).toContain(
      'FOREIGN KEY (favourites) REFERENCES tbl_favourites (id) ON DELETE CASCADE'
    );
    expect(result.sql).toContain('type TEXT NOT NULL');
    expect(result.sql).toContain('status TEXT NOT NULL');
    expect(result.sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_tbl_user_1234567_status ON tbl_user_1234567 (status)'
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

    expect(rollback.sql).not.toContain(
      'CREATE TABLE IF NOT EXISTS tbl_user_1234567'
    );
    expect(rollback.sql).toContain('DROP TABLE IF EXISTS tbl_user_1234567');
    expect(rollback.sql).toContain(
      'DROP INDEX IF EXISTS idx_tbl_user_1234567_status'
    );
  });

  test('multiple component definitions', () => {
    const userCdef: CDef[] = [
      {
        id: 'user',
        hash: '1234567',
        columns: [{ name: 'name', type: 'string' }]
      }
    ];
    const describableCdef: CDef[] = [
      {
        id: 'describable',
        hash: '1234567',
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
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user_1234567');
    expect(result.sql).toContain(
      'CREATE TABLE IF NOT EXISTS tbl_describable_1234567'
    );

    expect(result.sql).toContain('DROP TABLE IF EXISTS tbl_entity');
    expect(result.sql).toContain('DROP TABLE IF EXISTS tbl_user_1234567');
    expect(result.sql).toContain(
      'DROP TABLE IF EXISTS tbl_describable_1234567'
    );
  });

  test('should convert an enum component definition to a SQL table', () => {
    const cdef: CDef = {
      hash: '',
      id: 'user',
      columns: [
        { name: 'name', type: 'string' },
        {
          name: 'status',
          type: 'enum',
          optional: false,
          values: ['active', 'inactive']
        }
      ]
    };

    const result = cdefToSql(cdef);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user');
    expect(result.sql).toContain('name TEXT NULL');
    expect(result.sql).toContain('status TEXT NOT NULL');
  });

  describe('cdefToSqlInsert', () => {
    test('should convert a component definition to a SQL insert', () => {
      const cdef: CDef = {
        id: 'user',
        hash: '1234567',
        columns: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'int', optional: true },
          { name: 'email', type: 'email' }
        ]
      };

      const sql = cdefToSqlInsert(cdef);

      expect(sql).toBe(
        'INSERT INTO tbl_user_1234567 (eid, name, age, email) VALUES (?1, ?2, ?3, ?4)'
      );

      const selectSql = cdefToSqlSelect(cdef);
      expect(selectSql).toBe(
        'SELECT id, eid, name, age, email FROM tbl_user_1234567'
      );
    });
  });

  describe('query', () => {
    test('should query data from a table', () => {
      const cdef: CDef = {
        id: 'user',
        hash: '1234567',
        columns: [
          { name: 'age', type: 'int', optional: true },
          { name: 'email', type: 'email' },
          { name: 'id', type: 'pk' },
          { name: 'name', type: 'string' }
        ]
      };

      const sql = cdefToSqlSelectWhere(cdef, 'id', 'name');

      expect(sql).toEqual('SELECT id FROM tbl_user_1234567 WHERE name = ?1');

      const sqlAnd = cdefToSqlSelectWhere(cdef, 'name', ['email', 'age']);

      expect(sqlAnd).toEqual(
        'SELECT name FROM tbl_user_1234567 WHERE email = ?1 AND age = ?2'
      );
    });
  });
});

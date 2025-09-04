/* eslint-disable perfectionist/sort-objects */
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  dateTimeWithDefault,
  pkWithAutoIncrement,
  withForeignKey,
  withIndex,
  withUnique,
  withUniqueIndex
} from '@schema';
import {
  zodSchemaToSqliteIndexes,
  zodSchemaToSqliteInsert,
  zodSchemaToSqliteSchema,
  zodSchemaToSqliteSelect,
  zodSchemaToSqliteSelectWhere,
  zodSchemaToSqliteTable
} from '@schema/schema-to-sql';

describe('inserting data', () => {
  test('should insert data into a table', () => {
    const schema = z
      .object(
        // @ts-ignore
        {
          id: pkWithAutoIncrement(),
          age: z.number().optional(),
          email: z.email(),
          name: z.string()
        }
      )
      .meta({ name: 'tbl_users' });

    type User = z.infer<typeof schema>;

    const result = zodSchemaToSqliteTable(schema);

    const db = new Database(':memory:');
    db.exec(result.sql);

    const user: User = {
      email: 'john.doe@example.com',
      name: 'John Doe'
    };

    const sql = zodSchemaToSqliteInsert(schema);

    expect(sql).toBe(
      'INSERT INTO tbl_users (age, email, name) VALUES (?1, ?2, ?3)'
    );

    const query = db.query(sql);
    query.run(null, user.email, user.name);

    const selectSql = zodSchemaToSqliteSelect(schema);
    expect(selectSql).toBe('SELECT id, age, email, name FROM tbl_users');

    const selectQuery = db.query(selectSql);
    const userResult = selectQuery.get();

    expect(userResult).toEqual({
      age: null,
      email: 'john.doe@example.com',
      id: 1,
      name: 'John Doe'
    });
  });
});

describe('querying data', () => {
  test('should query data from a table', () => {
    const schema = z
      .object({
        age: z.number().optional(),
        email: z.email(),
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);

    const sql = zodSchemaToSqliteSelectWhere(result, 'id', 'name');

    expect(sql).toEqual('SELECT id FROM tbl_users WHERE name = ?1');

    const sqlAnd = zodSchemaToSqliteSelectWhere(result, 'name', [
      'email',
      'age'
    ]);

    expect(sqlAnd).toEqual(
      'SELECT name FROM tbl_users WHERE email = ?1 AND age = ?2'
    );
  });
});

describe('zodSchemaToSqliteTable', () => {
  test('should create a table with a primary key', () => {
    const schema = z
      .object({
        entityId: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result).toEqual({
      columns: [
        {
          constraints: ['PRIMARY KEY', 'AUTOINCREMENT'],
          name: 'entity_id',
          type: 'INTEGER'
        },
        { constraints: ['NOT NULL'], name: 'name', type: 'TEXT' }
      ],
      indexes: [],
      sql: `CREATE TABLE IF NOT EXISTS tbl_users (
  entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);`,
      tableName: 'tbl_users'
    });

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_users');
    expect(result.sql).toContain('entity_id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('should convert basic schema to SQLite table', () => {
    const userSchema = z
      .object({
        age: z.number().optional(),
        email: z.email(),
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(userSchema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
    expect(result.sql).toContain('email TEXT NOT NULL');
    expect(result.sql).toContain('age REAL NULL');
  });

  test('should use metadata to generate table name', () => {
    const schema = z
      .object({
        // no default for createdAt
        createdAt: z.iso.datetime(),
        id: pkWithAutoIncrement(),
        // default current timestamp for updatedAt
        updatedAt: dateTimeWithDefault()
      })
      .meta({
        name: 'tbl_entities'
      });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_entities');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('created_at DATETIME NOT NULL');
    expect(result.sql).toContain(
      'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
  });

  test('should handle different Zod types correctly', () => {
    const testSchema = z
      .object({
        boolean: z.boolean(),
        date: z.date(),
        enum: z.enum(['A', 'B', 'C']),
        id: pkWithAutoIncrement(),
        literal: z.literal('test'),
        nullable: z.number().nullable(),
        number: z.number(),
        optional: z.string().optional(),
        text: z.string(),
        union: z.union([z.string(), z.number()])
      })
      .meta({ name: 'test_table' });

    const result = zodSchemaToSqliteTable(testSchema);

    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('text TEXT NOT NULL');
    expect(result.sql).toContain('number REAL NOT NULL');
    expect(result.sql).toContain('boolean INTEGER NOT NULL');
    expect(result.sql).toContain('date TEXT NOT NULL');
    expect(result.sql).toContain('optional TEXT NULL');
    expect(result.sql).toContain('nullable REAL NULL');
    expect(result.sql).toContain('enum TEXT NOT NULL');
    expect(result.sql).toContain('literal TEXT NOT NULL');
    expect(result.sql).toContain('union TEXT NOT NULL');
  });

  test('should handle integer types correctly', () => {
    const intSchema = z
      .object({
        bigInt: z.bigint(),
        id: pkWithAutoIncrement(),
        smallInt: z.int(),
        thirtyTwo: z.int32()
      })
      .meta({ name: 'integers' });

    const result = zodSchemaToSqliteTable(intSchema);

    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('small_int INTEGER NOT NULL');
    expect(result.sql).toContain('thirty_two INTEGER NOT NULL');
    expect(result.sql).toContain('big_int TEXT NOT NULL');
  });

  test('should handle datetime fields specially', () => {
    const timeSchema = z
      .object({
        createdAt: z.date(),
        id: pkWithAutoIncrement(),
        someOtherDate: z.date(),
        updatedAt: z.date()
      })
      .meta({ name: 'timestamps' });

    const result = zodSchemaToSqliteTable(timeSchema);

    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('created_at TEXT NOT NULL');
    expect(result.sql).toContain('updated_at TEXT NOT NULL');
    expect(result.sql).toContain('some_other_date TEXT NOT NULL');
  });

  test('should handle default values', () => {
    const defaultSchema = z
      .object({
        active: z.boolean().default(true),
        id: pkWithAutoIncrement(),
        name: z.string().default('John')
      })
      .meta({ name: 'defaults' });

    const result = zodSchemaToSqliteTable(defaultSchema);

    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain("name TEXT NOT NULL DEFAULT 'John'");
    expect(result.sql).toContain('active INTEGER NOT NULL DEFAULT 1');
  });

  test('should generate valid SQL syntax', () => {
    const complexSchema = z
      .object({
        age: z.number().min(0).max(150).optional(),
        createdAt: z.date(),
        email: z.email(),
        firstName: z.string(),
        id: pkWithAutoIncrement(),
        isActive: z.boolean().default(true),
        lastName: z.string(),
        updatedAt: z.date()
      })
      .meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(complexSchema);

    // Should be valid SQL
    expect(result.sql).toMatch(
      /^CREATE TABLE IF NOT EXISTS users \([\S\s]*\);$/
    );

    // Should have proper comma separation
    const lines = result.sql.split('\n').filter((line: string) => line.trim());
    expect(lines[0]).toBe('CREATE TABLE IF NOT EXISTS users (');
    expect(lines.at(-1)).toBe(');');

    // All lines except first and last should end with comma (except the last column)
    for (let i = 1; i < lines.length - 2; i++) {
      const line = lines[i]?.trim();
      if (line && !line.startsWith('--')) {
        expect(line.endsWith(',')).toBe(true);
      }
    }

    // Check that column names are in snake_case
    expect(result.sql).toContain('first_name TEXT NOT NULL');
    expect(result.sql).toContain('last_name TEXT NOT NULL');
    expect(result.sql).toContain('is_active INTEGER NOT NULL');
    expect(result.sql).toContain('created_at TEXT NOT NULL');
    expect(result.sql).toContain('updated_at TEXT NOT NULL');
  });

  test('should work with the existing entity schema from main.test.ts', () => {
    const entitySchema = z
      .object({
        id: pkWithAutoIncrement(),

        createdAt: z.date(),
        updatedAt: z.date()
      })
      .meta({ name: 'entities' });

    const result = zodSchemaToSqliteTable(entitySchema);

    expect(result.sql).toBe(`CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);
  });

  test('should throw error when no table name is provided', () => {
    const schema = z.object({
      id: pkWithAutoIncrement(),
      name: z.string()
    });

    expect(() => zodSchemaToSqliteTable(schema)).toThrow(
      'Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter'
    );
  });

  test('should use options tableName to override metadata', () => {
    const schema = z
      .object({
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema, {
      tableName: 'custom_users'
    });

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS custom_users');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('should convert camelCase column names to snake_case', () => {
    const schema = z
      .object({
        createdAt: z.date(),
        emailAddress: z.email(),
        firstName: z.string(),
        hasPermission: z.boolean(),
        id: pkWithAutoIncrement(),
        isActive: z.boolean(),
        lastName: z.string(),
        phoneNumber: z.string(),
        updatedAt: z.date()
      })
      .meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('first_name TEXT NOT NULL');
    expect(result.sql).toContain('last_name TEXT NOT NULL');
    expect(result.sql).toContain('email_address TEXT NOT NULL');
    expect(result.sql).toContain('phone_number TEXT NOT NULL');
    expect(result.sql).toContain('created_at TEXT NOT NULL');
    expect(result.sql).toContain('updated_at TEXT NOT NULL');
    expect(result.sql).toContain('is_active INTEGER NOT NULL');
    expect(result.sql).toContain('has_permission INTEGER NOT NULL');
  });

  test('should handle default values from metadata', () => {
    const schema = z
      .object({
        age: z.number().default(18),
        createdAt: dateTimeWithDefault(),
        id: pkWithAutoIncrement(),
        isActive: z.boolean().default(true),
        name: z.string().default('John Doe'),
        updatedAt: dateTimeWithDefault()
      })
      .meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain("name TEXT NOT NULL DEFAULT 'John Doe'");
    expect(result.sql).toContain('age REAL NOT NULL DEFAULT 18');
    expect(result.sql).toContain('is_active INTEGER NOT NULL DEFAULT 1');
    expect(result.sql).toContain(
      'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
    expect(result.sql).toContain(
      'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
  });

  test('should handle unique constraints', () => {
    const schema = z
      .object({
        id: pkWithAutoIncrement(),
        name: withUnique(z.string())
      })
      .meta({ name: 'tbl_user' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user');
    expect(result.sql).toContain('name TEXT NOT NULL UNIQUE');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
  });

  test('should handle foreign key constraints', () => {
    const schema = z
      .object({
        id: pkWithAutoIncrement(),
        userId: withForeignKey(z.number(), 'tbl_user', true)
      })
      .meta({ name: 'tbl_user_role' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user_role');
    expect(result.sql).toContain('user_id INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain(
      'FOREIGN KEY (user_id) REFERENCES tbl_user (id) ON DELETE CASCADE'
    );
  });

  test('should handle foreign key constraints without cascade', () => {
    const schema = z
      .object({
        categoryId: withForeignKey(z.number(), 'tbl_categories'),
        id: pkWithAutoIncrement()
      })
      .meta({ name: 'tbl_products' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_products');
    expect(result.sql).toContain('category_id INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain(
      'FOREIGN KEY (category_id) REFERENCES tbl_categories (id)'
    );
    expect(result.sql).not.toContain('ON DELETE CASCADE');
  });

  test('should handle multiple foreign key constraints', () => {
    const schema = z
      .object({
        authorId: withForeignKey(z.number(), 'tbl_authors', true),
        categoryId: withForeignKey(z.number(), 'tbl_categories'),
        id: pkWithAutoIncrement(),
        userId: withForeignKey(z.number(), 'tbl_users', true)
      })
      .meta({ name: 'tbl_posts' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_posts');
    expect(result.sql).toContain('user_id INTEGER NOT NULL');
    expect(result.sql).toContain('category_id INTEGER NOT NULL');
    expect(result.sql).toContain('author_id INTEGER NOT NULL');
    expect(result.sql).toContain(
      'FOREIGN KEY (user_id) REFERENCES tbl_users (id) ON DELETE CASCADE'
    );
    expect(result.sql).toContain(
      'FOREIGN KEY (category_id) REFERENCES tbl_categories (id)'
    );
    expect(result.sql).toContain(
      'FOREIGN KEY (author_id) REFERENCES tbl_authors (id) ON DELETE CASCADE'
    );
  });

  test('foreign key constraints from inherited schema', () => {
    const baseSchema = z.object({
      id: pkWithAutoIncrement(),
      userId: z.number().meta({ cascade: true, foreignKey: 'tbl_users' })
    });
    const schema = baseSchema
      .extend({
        name: z.string()
      })
      .meta({ name: 'tbl_user_role' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_user_role');
    expect(result.sql).toContain('user_id INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain(
      'FOREIGN KEY (user_id) REFERENCES tbl_users (id) ON DELETE CASCADE'
    );
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('foreign key constraints are now generated for optional fields', () => {
    // This test verifies that foreign key constraints are now properly generated for optional fields

    const componentSchema = z
      .object({
        eid: z
          .int()
          .optional()
          .meta({ cascade: true, foreignKey: 'tbl_entity' }),
        id: pkWithAutoIncrement()
      })
      .meta({ name: 'tbl_component_test' });

    const result = zodSchemaToSqliteTable(componentSchema);

    // Basic table structure is correct
    expect(result.sql).toContain(
      'CREATE TABLE IF NOT EXISTS tbl_component_test'
    );
    expect(result.sql).toContain('eid INTEGER NULL');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');

    // Foreign key constraint should now be generated for optional fields
    expect(result.sql).toContain(
      'FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE'
    );
  });

  test('foreign key constraints work for non-optional fields', () => {
    // This test verifies that foreign key constraints work when the field is not optional

    const nonOptionalSchema = z
      .object({
        eid: z.int().meta({ cascade: true, foreignKey: 'tbl_entity' }),
        id: pkWithAutoIncrement()
      })
      .meta({ name: 'tbl_component_required' });

    const result = zodSchemaToSqliteTable(nonOptionalSchema);

    expect(result.sql).toContain(
      'CREATE TABLE IF NOT EXISTS tbl_component_required'
    );
    expect(result.sql).toContain('eid INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');

    // This should pass - foreign key constraint should be generated for non-optional fields
    expect(result.sql).toContain(
      'FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE'
    );
  });

  test('componentSchema extension now includes foreign key constraints', () => {
    // This test verifies that when extending componentSchema, foreign key constraints are properly included

    const componentSchema = z.object({
      eid: z.int().optional().meta({ cascade: true, foreignKey: 'tbl_entity' }),
      id: pkWithAutoIncrement()
    });

    const locationSchema = componentSchema
      .extend({
        name: z.string(),
        region: z.string()
      })
      .meta({ id: '/location/extension', name: 'tbl_locations' });

    const result = zodSchemaToSqliteTable(locationSchema);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS tbl_locations');
    expect(result.sql).toContain('eid INTEGER NULL');
    expect(result.sql).toContain('name TEXT NOT NULL');
    expect(result.sql).toContain('region TEXT NOT NULL');

    // Foreign key constraint should now be included in extended schemas
    expect(result.sql).toContain(
      'FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE'
    );
  });

  test('actual codebase componentSchema now works correctly', () => {
    // This test verifies that the actual componentSchema from the codebase now works correctly

    // This replicates the exact schema from src/component.ts
    const componentSchema = z.object({
      id: pkWithAutoIncrement(),

      eid: withForeignKey(z.int().optional(), 'tbl_entity', true)
    });

    // This replicates how location schema extends it
    const locationSchema = componentSchema
      .extend({
        name: z.string(),
        region: z.string()
      })
      .meta({ id: '/location/actual', name: 'tbl_locations' });

    const result = zodSchemaToSqliteTable(locationSchema);

    // Verify the expected structure is there
    expect(result.sql).toBe(`CREATE TABLE IF NOT EXISTS tbl_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE
);`);

    // Verify the foreign key constraint is included
    expect(result.sql).toContain('FOREIGN KEY');
    expect(result.sql).toContain('REFERENCES tbl_entity');
    expect(result.sql).toContain('ON DELETE CASCADE');
  });

  describe('JSON', () => {
    test('should generate JSON column', () => {
      const schema = z
        .object({
          id: pkWithAutoIncrement(),
          data: z.json()
        })
        .meta({ name: 'tbl_users' });

      const result = zodSchemaToSqliteTable(schema);

      expect(result.sql).toContain('data TEXT NOT NULL');
    });
  });
});

describe('SQLite Index Generation', () => {
  test('should generate single-column indexes from field metadata', () => {
    const schema = z
      .object({
        email: withIndex(z.email()),
        id: pkWithAutoIncrement(),
        name: withIndex(z.string(), 'idx_users_name'),
        username: withUniqueIndex(z.string())
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.indexes).toHaveLength(3);
    expect(result.indexes).toEqual([
      {
        columns: ['email'],
        name: 'idx_tbl_users_email',
        tableName: 'tbl_users',
        unique: false
      },
      {
        columns: ['name'],
        name: 'idx_users_name',
        tableName: 'tbl_users',
        unique: false
      },
      {
        columns: ['username'],
        name: 'idx_tbl_users_username',
        tableName: 'tbl_users',
        unique: true
      }
    ]);
  });

  test('should generate composite indexes from schema metadata', () => {
    const schema = z
      .object({
        categoryId: z.number(),
        id: pkWithAutoIncrement(),
        status: z.string(),
        userId: z.number()
      })
      .meta({
        indexes: [
          { columns: ['userId', 'status'] },
          { columns: ['categoryId', 'status'], unique: true },
          { columns: ['userId', 'categoryId'], name: 'idx_posts_user_category' }
        ],
        name: 'tbl_posts'
      });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.indexes).toHaveLength(3);
    expect(result.indexes).toEqual([
      {
        columns: ['user_id', 'status'],
        name: 'idx_tbl_posts_user_id_status',
        tableName: 'tbl_posts',
        unique: false
      },
      {
        columns: ['category_id', 'status'],
        name: 'idx_tbl_posts_category_id_status',
        tableName: 'tbl_posts',
        unique: true
      },
      {
        columns: ['user_id', 'category_id'],
        name: 'idx_posts_user_category',
        tableName: 'tbl_posts',
        unique: false
      }
    ]);
  });

  test('should generate index SQL statements', () => {
    const schema = z
      .object({
        email: withIndex(z.email()),
        id: pkWithAutoIncrement(),
        username: withUniqueIndex(z.string())
      })
      .meta({
        indexes: [{ columns: ['email', 'username'] }],
        name: 'tbl_users'
      });

    const result = zodSchemaToSqliteIndexes(schema);

    expect(result.sql).toEqual([
      'CREATE INDEX IF NOT EXISTS idx_tbl_users_email ON tbl_users (email);',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_tbl_users_username ON tbl_users (username);',
      'CREATE INDEX IF NOT EXISTS idx_tbl_users_email_username ON tbl_users (email, username);'
    ]);
  });

  test('should generate index SQL with IF NOT EXISTS by default', () => {
    const schema = z
      .object({
        email: withIndex(z.email()),
        id: pkWithAutoIncrement()
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteIndexes(schema);

    expect(result.sql).toEqual([
      'CREATE INDEX IF NOT EXISTS idx_tbl_users_email ON tbl_users (email);'
    ]);
  });

  test('should generate index SQL without IF NOT EXISTS when explicitly disabled', () => {
    const schema = z
      .object({
        email: withIndex(z.email()),
        id: pkWithAutoIncrement()
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteIndexes(schema, { ifNotExists: false });

    expect(result.sql).toEqual([
      'CREATE INDEX idx_tbl_users_email ON tbl_users (email);'
    ]);
  });

  test('should generate complete schema with table and indexes', () => {
    const schema = z
      .object({
        email: withIndex(z.email()),
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({
        indexes: [{ columns: ['name', 'email'] }],
        name: 'tbl_users'
      });

    const result = zodSchemaToSqliteSchema(schema);

    expect(result).toHaveLength(3); // 1 table + 2 indexes
    expect(result[0]).toContain('CREATE TABLE IF NOT EXISTS tbl_users');
    expect(result[1]).toContain(
      'CREATE INDEX IF NOT EXISTS idx_tbl_users_email ON tbl_users (email);'
    );
    expect(result[2]).toContain(
      'CREATE INDEX IF NOT EXISTS idx_tbl_users_name_email ON tbl_users (name, email);'
    );
  });

  test('should work with actual database operations', () => {
    const schema = z
      .object({
        email: withUniqueIndex(z.email()),
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({
        indexes: [{ columns: ['name'] }],
        name: 'tbl_users'
      });

    const db = new Database(':memory:');

    // Create table and indexes
    const schemaSql = zodSchemaToSqliteSchema(schema);
    for (const sql of schemaSql) {
      db.exec(sql);
    }

    // Insert data
    const insertSql = zodSchemaToSqliteInsert(schema);
    const stmt = db.query(insertSql);
    stmt.run('john@example.com', 'John Doe');

    // Query using indexed column
    const selectSql = zodSchemaToSqliteSelect(schema) + ' WHERE email = ?';
    const selectStmt = db.query(selectSql);
    const result = selectStmt.get('john@example.com');

    expect(result).toEqual({
      email: 'john@example.com',
      id: 1,
      name: 'John Doe'
    });
  });

  test('should handle camelCase column names in composite indexes', () => {
    const schema = z
      .object({
        firstName: z.string(),
        id: pkWithAutoIncrement(),
        lastName: z.string()
      })
      .meta({
        indexes: [{ columns: ['firstName', 'lastName'] }],
        name: 'tbl_users'
      });

    const result = zodSchemaToSqliteIndexes(schema);

    expect(result.sql).toEqual([
      'CREATE INDEX IF NOT EXISTS idx_tbl_users_first_name_last_name ON tbl_users (first_name, last_name);'
    ]);
  });

  test('should not generate indexes for fields without index metadata', () => {
    const schema = z
      .object({
        age: z.number(), // No index metadata
        email: withIndex(z.email()),
        id: pkWithAutoIncrement(),
        name: z.string() // No index metadata
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]?.columns).toEqual(['email']);
  });

  test('should handle empty indexes array gracefully', () => {
    const schema = z
      .object({
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({
        indexes: [],
        name: 'tbl_users'
      });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.indexes).toHaveLength(0);
  });

  test('should handle schema without any index metadata', () => {
    const schema = z
      .object({
        id: pkWithAutoIncrement(),
        name: z.string()
      })
      .meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.indexes).toHaveLength(0);
  });
});

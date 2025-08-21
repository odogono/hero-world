import { describe, test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteTable, zodSchemaToSqliteInsert, zodSchemaToSqliteSelect } from '../schema-to-sql';
import { Database } from 'bun:sqlite';


describe('inserting data', () => {

  test('should insert data into a table', () => {
    const schema = z.object({
      id: z.number().optional().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string(),
      email: z.string(),
      age: z.number().optional(),
    }).meta({ name: 'tbl_users' });

    type User = z.infer<typeof schema>;

    const result = zodSchemaToSqliteTable(schema);

    const db = new Database(':memory:');
    db.exec(result.sql);


    const user: User = {
      name: 'John Doe',
      email: 'john.doe@example.com'
    };

    const sql = zodSchemaToSqliteInsert(schema);

    expect(sql).toBe('INSERT INTO tbl_users (name, email, age) VALUES (?1, ?2, ?3)');


    const query = db.query(sql);
    query.run(user.name, user.email, null);

    const selectSql = zodSchemaToSqliteSelect(schema);
    expect(selectSql).toBe('SELECT id, name, email, age FROM tbl_users');

    const selectQuery = db.query(selectSql);
    const userResult = selectQuery.get();

    expect(userResult).toEqual({
      id: 1,
      name: 'John Doe',
      email: 'john.doe@example.com',
      age: null
    });
  });

})

describe('zodSchemaToSqliteTable', () => {


  test('should create a table with a primary key', () => {
    const schema = z.object({
      entityId: z.number().optional().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string(),
    }).meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);


    expect(result).toEqual({
      sql: `CREATE TABLE tbl_users (
  entity_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL
);`,
      columns: [
        { name: 'entity_id', type: 'INTEGER', constraints: ['PRIMARY KEY', 'AUTOINCREMENT', 'NOT NULL'] },
        { name: 'name', type: 'TEXT', constraints: ['NOT NULL'] },
      ],
      tableName: 'tbl_users'
    });

    expect(result.sql).toContain('CREATE TABLE tbl_users');
    expect(result.sql).toContain('entity_id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('should convert basic schema to SQLite table', () => {
    const userSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string(),
      email: z.string(),
      age: z.number().optional(),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(userSchema);
    
    expect(result.sql).toContain('CREATE TABLE users');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
    expect(result.sql).toContain('email TEXT NOT NULL');
    expect(result.sql).toContain('age REAL NULL');
  });

  test('should use metadata to generate table name', () => {
    const schema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
    }).meta({
      name: 'tbl_entities'
    });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE tbl_entities');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('created_at DATETIME NOT NULL');
    expect(result.sql).toContain('updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  test('should handle different Zod types correctly', () => {
    const testSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      text: z.string(),
      number: z.number(),
      boolean: z.boolean(),
      date: z.date(),
      optional: z.string().optional(),
      nullable: z.number().nullable(),
      enum: z.enum(['A', 'B', 'C']),
      literal: z.literal('test'),
      union: z.union([z.string(), z.number()]),
    }).meta({ name: 'test_table' });

    const result = zodSchemaToSqliteTable(testSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
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
    const intSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      smallInt: z.int(),
      thirtyTwo: z.int32(),
      bigInt: z.bigint(),
    }).meta({ name: 'integers' });

    const result = zodSchemaToSqliteTable(intSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('small_int INTEGER NOT NULL');
    expect(result.sql).toContain('thirty_two INTEGER NOT NULL');
    expect(result.sql).toContain('big_int TEXT NOT NULL');
  });

  test('should handle datetime fields specially', () => {
    const timeSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      createdAt: z.date(),
      updatedAt: z.date(),
      someOtherDate: z.date(),
    }).meta({ name: 'timestamps' });

    const result = zodSchemaToSqliteTable(timeSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('created_at TEXT NOT NULL');
    expect(result.sql).toContain('updated_at TEXT NOT NULL');
    expect(result.sql).toContain('some_other_date TEXT NOT NULL');
  });

  test('should handle default values', () => {
    const defaultSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string().default('John'),
      active: z.boolean().default(true),
    }).meta({ name: 'defaults' });

    const result = zodSchemaToSqliteTable(defaultSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
    expect(result.sql).toContain('active INTEGER NOT NULL');
  });

  test('should generate valid SQL syntax', () => {
    const complexSchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string().email(),
      age: z.number().min(0).max(150).optional(),
      isActive: z.boolean().default(true),
      createdAt: z.date(),
      updatedAt: z.date(),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(complexSchema);
    
    // Should be valid SQL
    expect(result.sql).toMatch(/^CREATE TABLE users \([\s\S]*\);$/);
    
    // Should have proper comma separation
    const lines = result.sql.split('\n').filter((line: string) => line.trim());
    expect(lines[0]).toBe('CREATE TABLE users (');
    expect(lines[lines.length - 1]).toBe(');');
    
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
    const entitySchema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      createdAt: z.date(),
      updatedAt: z.date(),
    }).meta({ name: 'entities' });

    const result = zodSchemaToSqliteTable(entitySchema);
    
    expect(result.sql).toBe(`CREATE TABLE entities (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);
  });

  test('should throw error when no table name is provided', () => {
    const schema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string(),
    });

    expect(() => zodSchemaToSqliteTable(schema)).toThrow(
      'Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter'
    );
  });

  test('should use options tableName to override metadata', () => {
    const schema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string(),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema, { tableName: 'custom_users' });
    
    expect(result.sql).toContain('CREATE TABLE custom_users');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('should convert camelCase column names to snake_case', () => {
    const schema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      firstName: z.string(),
      lastName: z.string(),
      emailAddress: z.string(),
      phoneNumber: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
      isActive: z.boolean(),
      hasPermission: z.boolean(),
    }).meta({ name: 'users' });

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
    const schema = z.object({
      id: z.number().meta({ primaryKey: true, autoIncrement: true }),
      name: z.string().meta({ default: "'John Doe'" }),
      age: z.number().meta({ default: '18' }),
      isActive: z.boolean().meta({ default: '1' }),
      createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
      updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema);
    
    expect(result.sql).toContain('name TEXT NOT NULL DEFAULT \'John Doe\'');
    expect(result.sql).toContain('age REAL NOT NULL DEFAULT 18');
    expect(result.sql).toContain('is_active INTEGER NOT NULL DEFAULT 1');
    expect(result.sql).toContain('created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(result.sql).toContain('updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

});
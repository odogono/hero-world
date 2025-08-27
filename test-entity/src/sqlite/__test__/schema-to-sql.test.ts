import { describe, test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteTable, zodSchemaToSqliteInsert, zodSchemaToSqliteSelect, zodSchemaToSqliteSelectWhere } from '../schema-to-sql';
import { Database } from 'bun:sqlite';


describe('inserting data', () => {

  test('should insert data into a table', () => {
    const schema = z.object(
      // @ts-ignore
      {
      id: z.number().optional().meta({ autoIncrement: true, primaryKey: true }),
      age: z.number().optional(),
      email: z.string(),
      name: z.string(),
    }).meta({ name: 'tbl_users' });

    type User = z.infer<typeof schema>;

    const result = zodSchemaToSqliteTable(schema);

    const db = new Database(':memory:');
    db.exec(result.sql);


    const user: User = {
      email: 'john.doe@example.com',
      name: 'John Doe'
    };

    const sql = zodSchemaToSqliteInsert(schema);

    expect(sql).toBe('INSERT INTO tbl_users (age, email, name) VALUES (?1, ?2, ?3)');


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

    const schema = z.object({
      age: z.number().optional(),
      email: z.string(),
      id: z.number().optional().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string(),
    }).meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);


    const sql = zodSchemaToSqliteSelectWhere(result, 'id', 'name');

    expect(sql).toEqual('SELECT id FROM tbl_users WHERE name = ?1');

    const sqlAnd = zodSchemaToSqliteSelectWhere(result, 'name', ['email', 'age']);

    expect(sqlAnd).toEqual('SELECT name FROM tbl_users WHERE email = ?1 AND age = ?2');
  });

})

describe('zodSchemaToSqliteTable', () => {


  test('should create a table with a primary key', () => {
    const schema = z.object({
      entityId: z.number().optional().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string(),
    }).meta({ name: 'tbl_users' });

    const result = zodSchemaToSqliteTable(schema);


    expect(result).toEqual({
      columns: [
        { constraints: ['PRIMARY KEY', 'AUTOINCREMENT', 'NOT NULL'], name: 'entity_id', type: 'INTEGER' },
        { constraints: ['NOT NULL'], name: 'name', type: 'TEXT' },
      ],
      sql: `CREATE TABLE tbl_users (
  entity_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL
);`,
      tableName: 'tbl_users'
    });

    expect(result.sql).toContain('CREATE TABLE tbl_users');
    expect(result.sql).toContain('entity_id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('should convert basic schema to SQLite table', () => {
    const userSchema = z.object({
      age: z.number().optional(),
      email: z.string(),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string(),
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
      createdAt: z.iso.datetime(),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
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
      boolean: z.boolean(),
      date: z.date(),
      enum: z.enum(['A', 'B', 'C']),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      literal: z.literal('test'),
      nullable: z.number().nullable(),
      number: z.number(),
      optional: z.string().optional(),
      text: z.string(),
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
      bigInt: z.bigint(),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      smallInt: z.int(),
      thirtyTwo: z.int32(),
    }).meta({ name: 'integers' });

    const result = zodSchemaToSqliteTable(intSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('small_int INTEGER NOT NULL');
    expect(result.sql).toContain('thirty_two INTEGER NOT NULL');
    expect(result.sql).toContain('big_int TEXT NOT NULL');
  });

  test('should handle datetime fields specially', () => {
    const timeSchema = z.object({
      createdAt: z.date(),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      someOtherDate: z.date(),
      updatedAt: z.date(),
    }).meta({ name: 'timestamps' });

    const result = zodSchemaToSqliteTable(timeSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('created_at TEXT NOT NULL');
    expect(result.sql).toContain('updated_at TEXT NOT NULL');
    expect(result.sql).toContain('some_other_date TEXT NOT NULL');
  });

  test('should handle default values', () => {
    const defaultSchema = z.object({
      active: z.boolean().default(true),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string().default('John'),
    }).meta({ name: 'defaults' });

    const result = zodSchemaToSqliteTable(defaultSchema);
    
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
    expect(result.sql).toContain('active INTEGER NOT NULL');
  });

  test('should generate valid SQL syntax', () => {
    const complexSchema = z.object({
      age: z.number().min(0).max(150).optional(),
      createdAt: z.date(),
      email: z.string().email(),
      firstName: z.string(),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      isActive: z.boolean().default(true),
      lastName: z.string(),
      updatedAt: z.date(),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(complexSchema);
    
    // Should be valid SQL
    expect(result.sql).toMatch(/^CREATE TABLE users \([\S\s]*\);$/);
    
    // Should have proper comma separation
    const lines = result.sql.split('\n').filter((line: string) => line.trim());
    expect(lines[0]).toBe('CREATE TABLE users (');
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
    const entitySchema = z.object({
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
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
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string(),
    });

    expect(() => zodSchemaToSqliteTable(schema)).toThrow(
      'Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter'
    );
  });

  test('should use options tableName to override metadata', () => {
    const schema = z.object({
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string(),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema, { tableName: 'custom_users' });
    
    expect(result.sql).toContain('CREATE TABLE custom_users');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

  test('should convert camelCase column names to snake_case', () => {
    const schema = z.object({
      createdAt: z.date(),
      emailAddress: z.string(),
      firstName: z.string(),
      hasPermission: z.boolean(),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      isActive: z.boolean(),
      lastName: z.string(),
      phoneNumber: z.string(),
      updatedAt: z.date(),
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
      age: z.number().meta({ default: '18' }),
      createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      isActive: z.boolean().meta({ default: '1' }),
      name: z.string().meta({ default: "'John Doe'" }),
      updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' }),
    }).meta({ name: 'users' });

    const result = zodSchemaToSqliteTable(schema);
    
    expect(result.sql).toContain('name TEXT NOT NULL DEFAULT \'John Doe\'');
    expect(result.sql).toContain('age REAL NOT NULL DEFAULT 18');
    expect(result.sql).toContain('is_active INTEGER NOT NULL DEFAULT 1');
    expect(result.sql).toContain('created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(result.sql).toContain('updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });


  test('should handle unique constraints', () => {
    const schema = z.object({
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      name: z.string().meta({ unique: true }),
    }).meta({ name: 'tbl_user' });
    
    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE tbl_user');
    expect(result.sql).toContain('name TEXT NOT NULL UNIQUE');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
  });


  test('should handle foreign key constraints', () => {
    const schema = z.object({
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      userId: z.number().meta({ cascade: true, foreignKey: 'tbl_user' }),
    }).meta({ name: 'tbl_user_role' });
    
    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE tbl_user_role');
    expect(result.sql).toContain('user_id INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('FOREIGN KEY (user_id) REFERENCES tbl_user (id) ON DELETE CASCADE');
  });

  test('should handle foreign key constraints without cascade', () => {
    const schema = z.object({
      categoryId: z.number().meta({ foreignKey: 'tbl_categories' }),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
    }).meta({ name: 'tbl_products' });
    
    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE tbl_products');
    expect(result.sql).toContain('category_id INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('FOREIGN KEY (category_id) REFERENCES tbl_categories (id)');
    expect(result.sql).not.toContain('ON DELETE CASCADE');
  });

  test('should handle multiple foreign key constraints', () => {
    const schema = z.object({
      authorId: z.number().meta({ cascade: true, foreignKey: 'tbl_authors' }),
      categoryId: z.number().meta({ foreignKey: 'tbl_categories' }),
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      userId: z.number().meta({ cascade: true, foreignKey: 'tbl_users' }),
    }).meta({ name: 'tbl_posts' });
    
    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE tbl_posts');
    expect(result.sql).toContain('user_id INTEGER NOT NULL');
    expect(result.sql).toContain('category_id INTEGER NOT NULL');
    expect(result.sql).toContain('author_id INTEGER NOT NULL');
    expect(result.sql).toContain('FOREIGN KEY (user_id) REFERENCES tbl_users (id) ON DELETE CASCADE');
    expect(result.sql).toContain('FOREIGN KEY (category_id) REFERENCES tbl_categories (id)');
    expect(result.sql).toContain('FOREIGN KEY (author_id) REFERENCES tbl_authors (id) ON DELETE CASCADE');
  });


  test('foreign key constraints from inherited schema', () => {
    const baseSchema = z.object({
      id: z.number().meta({ autoIncrement: true, primaryKey: true }),
      userId: z.number().meta({ cascade: true, foreignKey: 'tbl_users' }),
    });
    const schema = baseSchema.extend({
      name: z.string(),
    }).meta({ name: 'tbl_user_role' });

    const result = zodSchemaToSqliteTable(schema);

    expect(result.sql).toContain('CREATE TABLE tbl_user_role');
    expect(result.sql).toContain('user_id INTEGER NOT NULL');
    expect(result.sql).toContain('id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(result.sql).toContain('FOREIGN KEY (user_id) REFERENCES tbl_users (id) ON DELETE CASCADE');
    expect(result.sql).toContain('name TEXT NOT NULL');
  });

});
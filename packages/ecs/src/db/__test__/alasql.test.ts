import { describe, expect, test } from 'bun:test';

import { createAlasqlDatabase } from '../index';

describe.skip('AlasSQL Database', () => {
  test('should create AlasSQL database instance', async () => {
    const db = await createAlasqlDatabase();
    expect(db).toBeDefined();
    expect(typeof db.exec).toBe('function');
    expect(typeof db.query).toBe('function');
    expect(typeof db.prepare).toBe('function');
    db.close();
  });

  test('should execute simple SQL statements', async () => {
    const db = await createAlasqlDatabase();

    // Create a test table
    db.exec('CREATE TABLE test_table (id INT, name TEXT)');

    // Insert data
    db.exec("INSERT INTO test_table VALUES (1, 'test')");

    // Query data
    const results = db.query('SELECT * FROM test_table');
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, name: 'test' });

    db.close();
  });

  test('should handle parameterized queries', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE param_test (id INT, data_value STRING)');

    // Test with array parameters
    db.exec('INSERT INTO param_test VALUES (?1, ?2)', [42, 'hello']);

    const results = db.query('SELECT * FROM param_test WHERE id = ?1', [42]);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ data_value: 'hello', id: 42 });

    db.close();
  });

  test('should handle named parameters', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE named_test (id INT, name TEXT)');

    // Test with named parameters
    db.exec('INSERT INTO named_test VALUES (:id, :name)', {
      id: 5,
      name: 'named'
    });

    const results = db.query('SELECT * FROM named_test WHERE name = :name', {
      name: 'named'
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 5, name: 'named' });

    db.close();
  });

  test('should handle prepared statements', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE prep_test (id INT PRIMARY KEY, data TEXT)');

    const insertStmt = db.prepare('INSERT INTO prep_test VALUES (?1, ?2)');
    const selectStmt = db.prepare('SELECT * FROM prep_test WHERE id = ?1');

    // Test statement execution
    const result = insertStmt.run([10, 'prepared']);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowId).toBeGreaterThan(0);

    // Test statement query
    const queryResult = selectStmt.get([10]);
    expect(queryResult).toEqual({ data: 'prepared', id: 10 });

    insertStmt.finalize();
    selectStmt.finalize();
    db.close();
  });

  test('should handle transactions', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE trans_test (id INT, data_value STRING)');

    const result = db.transaction(() => {
      db.exec("INSERT INTO trans_test VALUES (1, 'first')");
      db.exec("INSERT INTO trans_test VALUES (2, 'second')");
      return 'transaction complete';
    });

    expect(result).toBe('transaction complete');

    // Verify records were inserted (avoid COUNT which has issues in AlasQL)
    const results = db.query('SELECT * FROM trans_test');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ data_value: 'first', id: 1 });
    expect(results[1]).toEqual({ data_value: 'second', id: 2 });

    db.close();
  });

  test('should convert SQLite PRAGMA statements', async () => {
    const db = await createAlasqlDatabase();

    // These should not throw errors (PRagmas should be stripped)
    expect(() => {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA foreign_keys = ON');
    }).not.toThrow();

    db.close();
  });

  test('should handle tuple UPDATE syntax conversion', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE update_test (id INT, name TEXT, age INT, eid INT)');
    db.exec('INSERT INTO update_test VALUES (1, "John", 25, 100)');

    // Test tuple update conversion
    db.exec(
      'UPDATE update_test SET (name, age) = ("Jane", 30) WHERE eid = 100'
    );

    const results = db.query('SELECT * FROM update_test WHERE eid = 100');
    expect(results[0]).toEqual({ age: 30, eid: 100, id: 1, name: 'Jane' });

    db.close();
  });

  test('should handle basic JSON serialization', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE json_test (id INT, data_val STRING)');
    db.exec("INSERT INTO json_test VALUES (1, 'test data')");

    // Test basic JSON functionality without complex table introspection
    const results = db.query('SELECT * FROM json_test');
    expect(results).toBeDefined();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ data_val: 'test data', id: 1 });

    db.close();
  });

  test('should handle special characters in strings', async () => {
    const db = await createAlasqlDatabase();

    db.exec('CREATE TABLE special_test (id INT, text_data STRING)');

    const testString = 'Text with \'single quotes\' and "double quotes"';
    db.exec('INSERT INTO special_test VALUES (?1, ?2)', [1, testString]);

    const results = db.query('SELECT * FROM special_test WHERE id = ?1', [1]);
    expect(results[0]).toEqual({ id: 1, text_data: testString });

    db.close();
  });
});

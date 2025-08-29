import { afterEach, describe, expect, it } from 'bun:test';

import {
  DatabaseType,
  createAutoDatabase,
  createBunDatabase,
  createDatabase,
  createWasmDatabase
} from '../index';

describe.skip('Database Factory', () => {
  afterEach(() => {
    // Clean up any open databases
  });

  describe('createDatabase', () => {
    it('should create a Bun database when type is BUN', async () => {
      const db = await createDatabase({
        path: ':memory:',
        type: DatabaseType.BUN
      });

      expect(db).toBeDefined();
      expect(typeof db.close).toBe('function');
      expect(typeof db.exec).toBe('function');
      expect(typeof db.prepare).toBe('function');

      // Test basic functionality
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      db.exec("INSERT INTO test (name) VALUES ('test')");

      const result = db.selectObjects('SELECT * FROM test');
      expect(result).toHaveLength(1);
      expect((result[0] as any).name).toBe('test');

      db.close();
    });

    it('should create a WASM database when type is WASM', async () => {
      const db = await createDatabase({
        path: ':memory:',
        type: DatabaseType.WASM
      });

      expect(db).toBeDefined();
      expect(typeof db.close).toBe('function');
      expect(typeof db.exec).toBe('function');
      expect(typeof db.prepare).toBe('function');

      // Test basic functionality
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
      db.exec("INSERT INTO test (name) VALUES ('test')");

      const result = db.selectObjects('SELECT * FROM test');
      expect(result).toHaveLength(1);
      expect((result[0] as any).name).toBe('test');

      db.close();
    });

    it('should throw error for unsupported database type', async () => {
      await expect(
        createDatabase({
          path: ':memory:',
          type: 'invalid' as DatabaseType
        })
      ).rejects.toThrow('Unsupported database type: invalid');
    });
  });

  describe('createBunDatabase', () => {
    it('should create a Bun database', async () => {
      const db = await createBunDatabase(':memory:');
      expect(db).toBeDefined();
      db.close();
    });
  });

  describe('createWasmDatabase', () => {
    it('should create a WASM database', async () => {
      const db = await createWasmDatabase(':memory:');
      expect(db).toBeDefined();
      db.close();
    });
  });

  describe('createAutoDatabase', () => {
    it('should create a database (Bun or WASM)', async () => {
      const db = await createAutoDatabase(':memory:');
      expect(db).toBeDefined();
      db.close();
    });
  });
});

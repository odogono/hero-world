import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'bun:test';

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Sqlite3Stmt = {
  bind: (args: unknown[]) => void;
  free: () => void;
  get: (args: unknown[]) => unknown[];
  getColumnNames: () => string[];
  step: () => boolean;
};

type Sqlite3 = { oo1: { DB: new (path: string, mode: string) => unknown } };

type Sqlite3DB = {
  close: () => void;
  exec: (sql: string) => void;
  pointer: number;
  prepare: (sql: string) => Sqlite3Stmt;
  selectArray: (sql: string) => unknown[];
  selectArrays: (sql: string) => unknown[][];
  selectObjects: (sql: string) => unknown[];
  selectValue: (sql: string) => number;
};

type CreateDbOptions = {
  enableTracing?: boolean;
};

const createDb = (
  sqlite3: Sqlite3,
  path: string = ':memory:',
  options: CreateDbOptions = {}
) => {
  const { enableTracing = false } = options;

  let flags = 'c';
  if (enableTracing) {
    flags += 't';
  }

  const db = new sqlite3.oo1.DB(path, flags) as Sqlite3DB;
  if (!enableTracing) {
    sqlite3.capi.sqlite3_trace_v2(db.pointer, 0, 0, 0);
  }

  sqlite3.config.error = (errCode: number, msg: string) => {
    // Suppress or redirect SQLite error logs
    // console.warn('SQLite error:', errCode, msg);
  };

  return db as Sqlite3DB;
};

const getLastInsertRowId = (sqlite3: Sqlite3, db: Sqlite3DB): number => {
  const rowid = sqlite3.capi.sqlite3_last_insert_rowid(db.pointer) as bigint;

  // Check if it's within JS safe integer range
  if (rowid > Number.MAX_SAFE_INTEGER || rowid < Number.MIN_SAFE_INTEGER) {
    throw new Error(
      `Rowid ${rowid} is outside the safe JS integer range. Use BigInt instead.`
    );
  }

  return Number(rowid);
};

const runTransaction = (db: Sqlite3DB, statements: string[]) => {
  db.exec('BEGIN TRANSACTION');
  try {
    for (const sql of statements) {
      db.exec(sql);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const doTransaction = (db: Sqlite3DB, run: () => void) => {
  db.exec('BEGIN TRANSACTION');
  try {
    run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const iterateQuery = function* (db: Sqlite3DB, sql: string) {
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) {
      yield stmt.get([]);
    }
  } finally {
    stmt.free();
  }
};

describe('sqlite.wasm', () => {
  let sqlite3: Sqlite3;

  beforeAll(async () => {
    // Initialize sqlite.wasm
    sqlite3 = await sqlite3InitModule({
      print: () => {},
      printErr: () => {}
    });
  });

  describe('Database Instantiation', () => {
    it('should create an in-memory database', () => {
      const db = createDb(sqlite3, ':memory:');
      expect(db).toBeDefined();
    });

    // it('should reject non-memory databases', () => {
    //   expect(() => {
    //     createDb(sqlite3, 'file.db');
    //   }).toThrow();
    // });

    it('should allow multiple in-memory databases', () => {
      const db1 = createDb(sqlite3, ':memory:');
      const db2 = createDb(sqlite3, ':memory:');

      expect(db1).not.toBe(db2);
    });
  });

  describe('Basic SQL Operations', () => {
    let db: Sqlite3DB;

    beforeEach(() => {
      db = createDb(sqlite3, ':memory:');
    });

    afterEach(() => {
      if (db && typeof db === 'object' && db !== null && 'close' in db) {
        (db as { close(): void }).close();
      }
    });

    it('should execute CREATE TABLE statements', () => {
      const result = db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      expect(result).toBeDefined();
    });

    it('should execute INSERT statements', () => {
      // Create table first
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      // Insert data
      const result = db.exec(`
        INSERT INTO entities (id, name) VALUES (1, 'player'), (2, 'enemy')
      `);

      expect(result).toBeDefined();
    });

    it('should execute SELECT statements', () => {
      // Setup test data
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      db.exec(`
        INSERT INTO entities (id, name) VALUES (1, 'player'), (2, 'enemy')
      `);

      // Query data
      const result = db.exec(`
        SELECT * FROM entities WHERE name = 'player'
      `);

      expect(result).toBeDefined();
    });

    it('should handle multiple operations in sequence', () => {
      const operations = [
        'CREATE TABLE components (id INTEGER PRIMARY KEY, type TEXT)',
        `INSERT INTO components (id, type) VALUES (1, 'position')`,
        `INSERT INTO components (id, type) VALUES (2, 'health')`
      ];
      runTransaction(db, operations);

      const result = db.selectValue('SELECT COUNT(*) as count FROM components');
      expect(result).toBe(2);
    });

    it('should retrieve the ID of the last inserted row', () => {
      // Create table with auto-incrementing ID
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        )
      `);

      // Insert first row
      db.exec(`INSERT INTO users (name) VALUES ('Alice')`);

      const firstId = getLastInsertRowId(sqlite3, db);
      expect(firstId).toBe(1);

      // Insert second row
      db.exec(`INSERT INTO users (name) VALUES ('Bob')`);
      const secondId = getLastInsertRowId(sqlite3, db);
      expect(secondId).toBe(2);

      // Insert third row
      db.exec(`INSERT INTO users (name) VALUES ('Charlie')`);
      const thirdId = getLastInsertRowId(sqlite3, db);
      expect(thirdId).toBe(3);

      // Verify all rows were inserted
      const result = db.selectObjects('SELECT * FROM users ORDER BY id');
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
    });

    it('should handle lastInsertRowId with explicit IDs', () => {
      // Create table without auto-increment
      db.exec(`
        CREATE TABLE items (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      // Insert with explicit ID
      db.exec(`INSERT INTO items (id, name) VALUES (100, 'Item A')`);
      const firstId = getLastInsertRowId(sqlite3, db);
      expect(firstId).toBe(100);

      // Insert with another explicit ID
      db.exec(`INSERT INTO items (id, name) VALUES (500, 'Item B')`);
      const secondId = getLastInsertRowId(sqlite3, db);
      expect(secondId).toBe(500);

      // Insert without explicit ID (should use next available)
      db.exec(`INSERT INTO items (name) VALUES ('Item C')`);
      const thirdId = getLastInsertRowId(sqlite3, db);
      expect(thirdId).toBe(501); // Should be the next available ID
    });
  });

  describe('ECS-Specific Operations', () => {
    let db: Sqlite3DB;

    beforeEach(() => {
      db = createDb(sqlite3, ':memory:');
    });

    afterEach(() => {
      if (db && typeof db === 'object' && db !== null && 'close' in db) {
        (db as { close(): void }).close();
      }
    });

    it('should create ECS tables', () => {
      const ecsTables = [
        `CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE components (
          id INTEGER PRIMARY KEY,
          entity_id INTEGER,
          component_type TEXT,
          data TEXT,
          FOREIGN KEY (entity_id) REFERENCES entities(id)
        )`,
        `CREATE TABLE systems (
          id INTEGER PRIMARY KEY,
          name TEXT UNIQUE,
          query TEXT,
          active BOOLEAN DEFAULT true
        )`
      ];

      ecsTables.forEach(sql => {
        const result = db.exec(sql);
        expect(result).toBeDefined();
      });
    });

    it('should handle entity creation and component attachment', () => {
      // Setup ECS schema
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE components (
          id INTEGER PRIMARY KEY,
          entity_id INTEGER,
          component_type TEXT,
          data TEXT,
          FOREIGN KEY (entity_id) REFERENCES entities(id)
        )
      `);

      // Create entity
      const entityResult = db.exec(`
        INSERT INTO entities (id) VALUES (1)
      `);
      expect(entityResult).toBeDefined();

      // Attach components
      const componentResults = [
        db.exec(
          `INSERT INTO components (entity_id, component_type, data) VALUES (1, 'position', '{"x": 10, "y": 20}')`
        ),
        db.exec(
          `INSERT INTO components (entity_id, component_type, data) VALUES (1, 'health', '{"current": 100, "max": 100}')`
        )
      ];

      componentResults.forEach(result => {
        expect(result).toBeDefined();
      });
    });

    it('should support complex ECS queries', () => {
      // Setup ECS schema
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE components (
          id INTEGER PRIMARY KEY,
          entity_id INTEGER,
          component_type TEXT,
          data TEXT,
          FOREIGN KEY (entity_id) REFERENCES entities(id)
        )
      `);

      // Create test data
      db.exec(`INSERT INTO entities (id) VALUES (1), (2), (3)`);
      db.exec(
        `INSERT INTO components (entity_id, component_type, data) VALUES (1, 'position', '{"x": 10, "y": 20}')`
      );
      db.exec(
        `INSERT INTO components (entity_id, component_type, data) VALUES (1, 'health', '{"current": 100, "max": 100}')`
      );
      db.exec(
        `INSERT INTO components (entity_id, component_type, data) VALUES (2, 'position', '{"x": 30, "y": 40}')`
      );
      db.exec(
        `INSERT INTO components (entity_id, component_type, data) VALUES (3, 'health', '{"current": 50, "max": 100}')`
      );

      // Complex query: find entities with both position and health components
      const result = db.selectObjects(`
        SELECT DISTINCT e.id 
        FROM entities e
        INNER JOIN components c1 ON e.id = c1.entity_id AND c1.component_type = 'position'
        INNER JOIN components c2 ON e.id = c2.entity_id AND c2.component_type = 'health'
      `);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('Error Handling', () => {
    let db: Sqlite3DB;

    beforeEach(() => {
      db = createDb(sqlite3, ':memory:');
    });

    afterEach(() => {
      if (db && typeof db === 'object' && db !== null && 'close' in db) {
        (db as { close(): void }).close();
      }
    });

    it('should handle invalid SQL gracefully', () => {
      expect(() => {
        db.exec('INVALID SQL STATEMENT');
      }).toThrow();
    });

    it('should prevent operations on closed database', () => {
      db.close();

      expect(() => {
        db.exec('SELECT 1');
      }).toThrow('DB has been closed.');
    });

    it('should handle foreign key constraints', () => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY
        )
      `);

      db.exec(`
        CREATE TABLE components (
          id INTEGER PRIMARY KEY,
          entity_id INTEGER,
          FOREIGN KEY (entity_id) REFERENCES entities(id)
        )
      `);

      // This should fail due to foreign key constraint
      expect(() => {
        db.exec(`INSERT INTO components (entity_id) VALUES (999)`);
      }).toThrow();
    });
  });

  describe('Performance Tests', () => {
    let db: Sqlite3DB;

    beforeEach(() => {
      db = createDb(sqlite3, ':memory:');
    });

    afterEach(() => {
      if (db && typeof db === 'object' && db !== null && 'close' in db) {
        (db as { close(): void }).close();
      }
    });

    it('should handle bulk operations efficiently', () => {
      // Setup
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);

      // Bulk insert
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        db.exec(`INSERT INTO entities (id, name) VALUES (${i}, 'entity_${i}')`);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should handle bulk operations with transactions', () => {
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);

      const startTime = performance.now();

      doTransaction(db, () => {
        for (let i = 0; i < 1000; i++) {
          db.exec(
            `INSERT INTO entities (id, name) VALUES (${i}, 'entity_${i}')`
          );
        }
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should handle concurrent operations', () => {
      db.exec(`
        CREATE TABLE test (
          id INTEGER PRIMARY KEY,
          value TEXT
        )
      `);

      // Simulate concurrent-like operations
      const operations = Array.from(
        { length: 100 },
        (_, i) => `INSERT INTO test (id, value) VALUES (${i}, 'value_${i}')`
      );

      operations.forEach(sql => {
        const result = db.exec(sql);
        expect(result).toBeDefined();
      });

      // Verify all data was inserted
      const countResult = db.exec('SELECT COUNT(*) as count FROM test');
      expect(countResult).toBeDefined();
    });
  });

  describe('Prepared Statements', () => {
    let db: Sqlite3DB;

    beforeEach(() => {
      db = createDb(sqlite3, ':memory:');
    });

    afterEach(() => {
      if (db && typeof db === 'object' && db !== null && 'close' in db) {
        (db as { close(): void }).close();
      }
    });

    it('should handle prepared statements', () => {
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);

      db.exec(`
        INSERT INTO entities (id, name) VALUES (1, 'entity_1')
      `);

      const stmt = db.prepare('SELECT * FROM entities WHERE id = ?');
      stmt.bind([1]);
      expect(stmt.step()).toBe(true);
      const columns = stmt.getColumnNames();

      expect(columns).toEqual(['id', 'name']);
      const result = stmt.get([]);

      expect(result).toEqual([1, 'entity_1']);
    });
  });
});

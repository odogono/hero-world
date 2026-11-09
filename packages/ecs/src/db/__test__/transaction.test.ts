// A transaction within a transaction nests as a savepoint, in both drivers,
// so code that opens one needn't know whether its caller has (#165).
import { describe, expect, test } from 'bun:test';

import { DatabaseType, createDatabase, type Database } from '../index';

const open = async (type: DatabaseType) => {
  const db = await createDatabase({ path: ':memory:', type });
  db.exec('CREATE TABLE t (n INTEGER)');
  return db;
};

const count = (db: Database) =>
  (db.query('SELECT count(*) AS n FROM t') as { n: number }[])[0]!.n;

for (const type of [DatabaseType.BUN, DatabaseType.WASM]) {
  describe(`${type} transactions`, () => {
    test('nest, and an inner one that throws undoes only itself', async () => {
      const db = await open(type);
      db.transaction(() => {
        db.exec('INSERT INTO t VALUES (1)');
        expect(() =>
          db.transaction(() => {
            db.exec('INSERT INTO t VALUES (2)');
            throw new Error('undo me');
          })
        ).toThrow('undo me');
        db.transaction(() => db.exec('INSERT INTO t VALUES (3)'));
      });
      expect(count(db)).toBe(2);
    });

    test('nest within a transaction begun by hand', async () => {
      const db = await open(type);
      db.exec('BEGIN');
      db.transaction(() => db.exec('INSERT INTO t VALUES (1)'));
      db.exec('ROLLBACK');
      expect(count(db)).toBe(0);
    });
  });
}

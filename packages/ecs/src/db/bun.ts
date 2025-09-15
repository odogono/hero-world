import { existsSync, unlinkSync } from 'node:fs';

import type {
  Database as BunDatabase,
  Changes,
  SQLQueryBindings
} from 'bun:sqlite';

import { parseArgs } from './helpers';
import type {
  CreateDatabaseOptions,
  Database,
  LoadFromJSONOptions,
  SaveToJSONOptions,
  Statement,
  StatementArgs,
  StatementRunResult
} from './index';
import {
  loadFromJSON as sharedLoadFromJSON,
  saveToJSON as sharedSaveToJSON
} from './json-functions';

// Wrapper for Bun SQLite database
export class BunDatabaseWrapper implements Database {
  private db: BunDatabase;

  constructor(db: BunDatabase) {
    this.db = db;
  }

  close(): void {
    this.db.close();
  }

  addEntity(): number {
    const r = this.db.run('INSERT INTO tbl_entity DEFAULT VALUES');
    return r.lastInsertRowid as number;
  }

  exec(
    sql: string,
    input?: StatementArgs,
    ...rest: StatementArgs[]
  ): Changes | void {
    const args = parseArgs(input, ...rest);
    return !args
      ? this.db.run(sql)
      : this.db.query(sql).run(args as unknown as SQLQueryBindings);
  }

  query(
    sql: string,
    input?: StatementArgs,
    ...rest: StatementArgs[]
  ): unknown[] {
    const args = parseArgs(input, ...rest);
    return !args
      ? this.db.query(sql).all()
      : this.db.query(sql).all(args as unknown as SQLQueryBindings);
  }

  prepare(sql: string): Statement {
    const stmt = this.db.query(sql);
    // console.log('prepare', sql, stmt.toString());
    return {
      all: (args?: StatementArgs) =>
        stmt.all(args as unknown as SQLQueryBindings),
      finalize: () => stmt.finalize(),
      get: (input?: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        return stmt.get(args as unknown as SQLQueryBindings);
      },
      getColumnNames: () => stmt.columnNames,
      iterate: (args?: StatementArgs) =>
        stmt.iterate(args as unknown as SQLQueryBindings),
      run: (input?: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        if (!args) {
          return convertChangesToStatementRunResult(
            stmt.run() as unknown as Changes
          );
        }

        return convertChangesToStatementRunResult(
          stmt.run(args as SQLQueryBindings)
        );
      }
    };
  }

  // selectArray(sql: string): unknown[] {
  //   const stmt = this.db.prepare(sql);
  //   const result = stmt.all();
  //   stmt.finalize();
  //   return result as unknown[];
  // }

  // selectArrays(sql: string): unknown[][] {
  //   const stmt = this.db.prepare(sql);
  //   const result = stmt.all();
  //   stmt.finalize();
  //   return result as unknown[][];
  // }

  // selectObjects(sql: string): unknown[] {
  //   const stmt = this.db.prepare(sql);
  //   const result = stmt.all();
  //   stmt.finalize();
  //   return result as unknown[];
  // }

  // selectValue(sql: string): number {
  //   const stmt = this.db.prepare(sql);
  //   const result = stmt.get();
  //   stmt.finalize();
  //   return result as number;
  // }

  // lastInsertRowId(): number {
  //   return 0;
  // }

  saveToPath(path: string) {
    // if the file exists, delete it
    if (existsSync(path)) {
      unlinkSync(path);
    }

    this.db.run(`VACUUM main INTO '${path}'`);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)() as T;
  }

  saveToJSON(options: SaveToJSONOptions = {}): unknown {
    return sharedSaveToJSON(this, options);
  }

  loadFromJSON(json: unknown, options: LoadFromJSONOptions = {}): void {
    sharedLoadFromJSON(this, json, options);
  }

  dump(): string {
    const dump: string[] = [];
    dump.push('PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;');

    // --- Schema (tables, indexes, triggers, views)
    const schema = this.db
      .query(
        `SELECT sql FROM sqlite_master 
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY type='table' DESC, type, name;`
      )
      .all();

    for (const { sql } of schema) {
      dump.push(sql + ';');
    }

    // --- Tables data
    const tables = this.db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all();

    for (const { name } of tables) {
      const rows = this.db.query(`SELECT * FROM ${name}`).all();
      if (rows.length === 0) {
        continue;
      }

      const cols = Object.keys(rows[0]);

      for (const row of rows) {
        const values = cols
          .map(col => {
            const val = (row as Record<string, unknown>)[col];
            if (val === null) {
              return 'NULL';
            }
            if (typeof val === 'number') {
              return val.toString();
            }
            if (val instanceof Uint8Array) {
              // BLOB → hex literal
              return `X'${Buffer.from(val).toString('hex')}'`;
            }
            // Text → single-quoted and escaped
            return `'${String(val).replaceAll("'", "''")}'`;
          })
          .join(', ');
        dump.push(
          `INSERT INTO ${name} (${cols
            .map(c => `"${c}"`)
            .join(', ')}) VALUES (${values});`
        );
      }
    }

    dump.push('COMMIT;');
    return dump.join('\n');
  }
}

// Factory function for Bun SQLite
export const createBunDatabaseInstance = async (
  options: CreateDatabaseOptions
): Promise<Database> => {
  const {
    clearExisting = false,
    path = ':memory:',
    readonly = false,
    walMode = 'OFF'
  } = options;
  const { Database } = await import('bun:sqlite');

  if (path !== ':memory:' && clearExisting) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  const db = new Database(path, { readonly, strict: true });

  if (walMode === 'WAL') {
    db.run('PRAGMA journal_mode = WAL;');
  } else {
    db.run('PRAGMA journal_mode = OFF;');
  }

  return new BunDatabaseWrapper(db);
};

const convertChangesToStatementRunResult = (
  changes: Changes
): StatementRunResult => ({
  changes: Number(changes.changes),
  lastInsertRowId: Number(changes.lastInsertRowid)
});

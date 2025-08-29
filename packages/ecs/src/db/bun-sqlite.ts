import { existsSync, unlinkSync } from 'node:fs';

import type {
  Database as BunDatabase,
  Changes,
  SQLQueryBindings
} from 'bun:sqlite';

import { parseArgs } from './helpers';
import { loadFromJSON as sharedLoadFromJSON, saveToJSON as sharedSaveToJSON } from './json-functions';
import type {
  Database,
  LoadFromJSONOptions,
  SaveToJSONOptions,
  Statement,
  StatementArgs,
  StatementRunResult
} from './index';

// Wrapper for Bun SQLite database
export class BunDatabaseWrapper implements Database {
  private db: BunDatabase;

  constructor(db: BunDatabase) {
    this.db = db;
  }

  close(): void {
    this.db.close();
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
}

// Factory function for Bun SQLite
export const createBunDatabaseInstance = async (
  path: string
): Promise<Database> => {
  const { Database } = await import('bun:sqlite');
  const db = new Database(path, { strict: true });
  return new BunDatabaseWrapper(db);
};

const convertChangesToStatementRunResult = (
  changes: Changes
): StatementRunResult => ({
  changes: Number(changes.changes),
  lastInsertRowId: Number(changes.lastInsertRowid)
});

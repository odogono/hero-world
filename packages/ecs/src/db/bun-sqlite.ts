import { existsSync, unlinkSync } from 'node:fs';

import type {
  Database as BunDatabase,
  Changes,
  SQLQueryBindings
} from 'bun:sqlite';

import type {
  Database,
  Statement,
  StatementArgs,
  StatementRunResult
} from './index';

const isArray = (args: unknown): args is unknown[] => Array.isArray(args);
const isObject = (args: unknown): args is Record<string, unknown> =>
  typeof args === 'object' && args !== null;

const parseArgs = (
  args: unknown[] | Record<string, unknown> | unknown,
  ...rest: unknown[]
) => {
  if (!args && rest.length === 0) {
    return null;
  }

  if (Array.isArray(args)) {
    return args;
  } else if (isObject(args) && rest.length === 0) {
    return args;
  } else if (rest.length > 0) {
    return [args, ...rest];
  } else {
    return [args];
  }
};

// Wrapper for Bun SQLite database
export class BunDatabaseWrapper implements Database {
  private db: BunDatabase;

  constructor(db: BunDatabase) {
    this.db = db;
  }

  close(): void {
    this.db.close();
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  prepare(sql: string): Statement {
    const stmt = this.db.query(sql);
    // console.log('prepare', sql, stmt.toString());
    return {
      all: (args?: StatementArgs) =>
        stmt.all(args as unknown as SQLQueryBindings),
      bind: (args: StatementArgs) => {
        // stmt.bind(convertKeysToNamedParams(args));
      },
      finalize: () => stmt.finalize(),
      get: (input: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        return stmt.get(args as unknown as SQLQueryBindings);
      },
      getColumnNames: () => stmt.columnNames,
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
      },
      step: () => false
    };
  }

  selectArray(sql: string): unknown[] {
    const stmt = this.db.prepare(sql);
    const result = stmt.all();
    stmt.finalize();
    return result as unknown[];
  }

  selectArrays(sql: string): unknown[][] {
    const stmt = this.db.prepare(sql);
    const result = stmt.all();
    stmt.finalize();
    return result as unknown[][];
  }

  selectObjects(sql: string): unknown[] {
    const stmt = this.db.prepare(sql);
    const result = stmt.all();
    stmt.finalize();
    return result as unknown[];
  }

  selectValue(sql: string): number {
    const stmt = this.db.prepare(sql);
    const result = stmt.get();
    stmt.finalize();
    return result as number;
  }

  lastInsertRowId(): number {
    return 0;
  }

  saveToPath(path: string): Promise<void> {
    // if the file exists, delete it
    if (existsSync(path)) {
      unlinkSync(path);
    }

    this.db.run(`VACUUM main INTO '${path}'`);
    return Promise.resolve();
  }

  transaction(fn: () => void): () => void {
    return this.db.transaction(fn);
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

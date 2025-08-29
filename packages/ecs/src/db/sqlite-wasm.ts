import type {
  BindingSpec,
  Database as Sqlite3Database,
  Sqlite3Static
} from '@sqlite.org/sqlite-wasm';

import { convertKeysToNamedParams, isObject, parseArgs } from './helpers';
import type {
  Database,
  LoadFromJSONOptions,
  SaveToJSONOptions,
  Statement,
  StatementArgs
} from './index';
import {
  loadFromJSON as sharedLoadFromJSON,
  saveToJSON as sharedSaveToJSON
} from './json-functions';

// Wrapper for SQLite WASM database
export class WasmDatabaseWrapper implements Database {
  private db: Sqlite3Database;
  private sqlite3: Sqlite3Static;

  constructor(db: Sqlite3Database, sqlite3: Sqlite3Static) {
    this.db = db;
    this.sqlite3 = sqlite3;
  }

  close(): void {
    this.db.close();
  }

  addEntity(): number {
    this.db.exec('INSERT INTO tbl_entity DEFAULT VALUES');
    return this.lastInsertRowId();
  }

  exec(sql: string, input?: StatementArgs, ...rest: StatementArgs[]): void {
    const args = parseArgs(input, ...rest);
    if (!args) {
      this.db.exec(sql);
    } else {
      this.db.selectObjects(sql, args as unknown as BindingSpec);
    }
  }

  query(
    sql: string,
    input?: StatementArgs,
    ...rest: StatementArgs[]
  ): unknown[] {
    const args = parseArgs(input, ...rest);
    return !args
      ? this.db.selectObjects(sql)
      : this.db.selectObjects(sql, args as unknown as BindingSpec);
  }

  prepare(sql: string): Statement {
    // console.log('prepare', sql);
    const stmt = this.db.prepare(sql);
    return {
      all: (args?: StatementArgs) => {
        const results = this.db.selectObjects(
          sql,
          args as unknown as BindingSpec
        );
        // this.db.exec('BEGIN');
        // stmt.reset();
        // console.log('all', sql, args);
        // // throw new Error('test');
        // stmt.bind(args as unknown as BindingSpec);
        // const results: unknown[] = [];
        // while (stmt.step()) {
        //   results.push(stmt.get({}));
        // }
        // this.db.exec('COMMIT');
        return results;
      },
      finalize: () => {
        throw new Error('Method not implemented.');
      },
      get: (input?: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        // console.log('get', sql, args);
        stmt.reset();
        if (args) {
          stmt.bind(args as unknown as BindingSpec);
        }
        if (stmt.step()) {
          const result = stmt.get({});
          // console.log('result', result);
          return result;
        }
        return null;
      },
      getColumnNames: () => {
        throw new Error('Method not implemented.');
      },
      iterate: (args?: StatementArgs) => {
        stmt.reset();
        if (args) {
          stmt.bind(args as unknown as BindingSpec);
        }
        return {
          *[Symbol.iterator]() {
            while (stmt.step()) {
              yield stmt.get({});
            }
          }
        };
      },
      run: (input?: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        stmt.reset();
        if (args) {
          if (Array.isArray(args)) {
            stmt.bind(args as BindingSpec);
          } else if (isObject(args)) {
            // console.log('run', sql, args);
            stmt.bind(convertKeysToNamedParams(args) as BindingSpec);
          }
        }
        stmt.step();
        return {
          changes: this.changes(),
          lastInsertRowId: this.lastInsertRowId()
        };
      }
    };
  }

  changes(): number {
    return this.sqlite3.capi.sqlite3_changes(this.db) as number;
  }

  lastInsertRowId(): number {
    const rowid = this.sqlite3.capi.sqlite3_last_insert_rowid(
      this.db
    ) as bigint;

    // Check if it's within JS safe integer range
    if (rowid > Number.MAX_SAFE_INTEGER || rowid < Number.MIN_SAFE_INTEGER) {
      throw new Error(
        `Rowid ${rowid} is outside the safe JS integer range. Use BigInt instead.`
      );
    }

    return Number(rowid);
  }

  saveToPath(path: string) {
    const binary = this.sqlite3.capi.sqlite3_js_db_export(this.db);
    Bun.write(path, binary);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  saveToJSON(options: SaveToJSONOptions = {}): unknown {
    return sharedSaveToJSON(this, options);
  }

  loadFromJSON(json: unknown, options: LoadFromJSONOptions = {}): void {
    sharedLoadFromJSON(this, json, options);
  }
}

// Factory function for SQLite WASM
export const createWasmDatabaseInstance = async (
  path: string,
  enableTracing: boolean = false
): Promise<Database> => {
  const sqliteWasm = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await sqliteWasm.default({
    print: () => {},
    printErr: () => {}
  });

  let flags = 'c';
  if (enableTracing) {
    flags += 't';
  }

  const db = new sqlite3.oo1.DB(path, flags);

  if (!enableTracing) {
    // @ts-expect-error - sqlite3_trace_v2 claims 3 args, but it's actually 4
    sqlite3.capi.sqlite3_trace_v2(db, 0, null, 0);
  }

  sqlite3.config.error = (errCode: number, msg: string) => {
    // Suppress or redirect SQLite error logs
    // console.warn('SQLite error:', errCode, msg);
  };

  // NOTE doesnt affect performance sadly
  // db.exec(`
  //   PRAGMA synchronous = OFF;
  //   PRAGMA journal_mode = MEMORY;
  //   PRAGMA temp_store = MEMORY;
  // `);

  return new WasmDatabaseWrapper(db, sqlite3);
};

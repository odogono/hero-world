import type { UnifiedDatabase, UnifiedStatement } from './index';

// Types for sqlite-wasm
type Sqlite3Stmt = {
  bind: (args: unknown[]) => void;
  free: () => void;
  get: (args: unknown[]) => unknown[];
  getColumnNames: () => string[];
  step: () => boolean;
};

type Sqlite3 = {
  capi: {
    sqlite3_last_insert_rowid: (pointer: number) => bigint;
    sqlite3_trace_v2: (
      pointer: number,
      mask: number,
      callback: number,
      context: number
    ) => void;
  };
  config: {
    error: (errCode: number, msg: string) => void;
  };
  oo1: {
    DB: new (path: string, mode: string) => unknown;
  };
};

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

// Wrapper for SQLite WASM database
export class WasmDatabaseWrapper implements UnifiedDatabase {
  private db: Sqlite3DB;
  private sqlite3: Sqlite3;

  constructor(db: Sqlite3DB, sqlite3: Sqlite3) {
    this.db = db;
    this.sqlite3 = sqlite3;
  }

  close(): void {
    this.db.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): UnifiedStatement {
    const stmt = this.db.prepare(sql);
    return {
      bind: (args: unknown[]) => stmt.bind(args),
      free: () => stmt.free(),
      get: (args: unknown[]) => stmt.get(args),
      getColumnNames: () => stmt.getColumnNames(),
      step: () => stmt.step()
    };
  }

  selectArray(sql: string): unknown[] {
    return this.db.selectArray(sql);
  }

  selectArrays(sql: string): unknown[][] {
    return this.db.selectArrays(sql);
  }

  selectObjects(sql: string): unknown[] {
    return this.db.selectObjects(sql);
  }

  selectValue(sql: string): number {
    return this.db.selectValue(sql);
  }

  lastInsertRowId(): number {
    const rowid = this.sqlite3.capi.sqlite3_last_insert_rowid(
      this.db.pointer
    ) as bigint;

    // Check if it's within JS safe integer range
    if (rowid > Number.MAX_SAFE_INTEGER || rowid < Number.MIN_SAFE_INTEGER) {
      throw new Error(
        `Rowid ${rowid} is outside the safe JS integer range. Use BigInt instead.`
      );
    }

    return Number(rowid);
  }
}

// Factory function for SQLite WASM
export async function createWasmDatabaseInstance(
  path: string,
  enableTracing: boolean = false
): Promise<UnifiedDatabase> {
  const sqliteWasm = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await sqliteWasm.default({
    print: () => {},
    printErr: () => {}
  });

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

  return new WasmDatabaseWrapper(db, sqlite3);
}

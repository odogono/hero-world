// Unified database interface
export type Database = {
  close: () => void;
  exec: (sql: string) => void;
  // lastInsertRowId: () => number;
  prepare: (sql: string) => Statement;
  saveToPath: (path: string) => void;
  // selectArray: (sql: string) => unknown[];
  // selectArrays: (sql: string) => unknown[][];
  // selectObjects: (sql: string) => unknown[];
  // selectValue: (sql: string) => number;
  transaction: <T>(fn: () => T) => T;
};

export type StatementRunResult = {
  changes: number;
  lastInsertRowId: number;
};

export type StatementArgs = unknown[] | Record<string, unknown> | unknown;

export type StatementGet = (
  input?: StatementArgs,
  ...rest: StatementArgs[]
) => unknown | null;

export type Statement = {
  all: (args?: StatementArgs) => unknown | null;

  finalize: () => void;
  get: StatementGet;
  getColumnNames: () => string[];
  run: (args?: StatementArgs) => StatementRunResult;
};

// Database type enum
export const DatabaseType = {
  BUN: 'bun',
  WASM: 'wasm'
} as const;

export type DatabaseType = (typeof DatabaseType)[keyof typeof DatabaseType];

// Options for database creation
export type CreateDatabaseOptions = {
  enableTracing?: boolean;
  path?: string;
  type: DatabaseType;
};

// Main database factory function
export const createDatabase = async (
  options: CreateDatabaseOptions
): Promise<Database> => {
  const { enableTracing = false, path = ':memory:', type } = options;

  switch (type) {
    case DatabaseType.BUN: {
      const { createBunDatabaseInstance } = await import('./bun-sqlite');
      return createBunDatabaseInstance(path);
    }

    case DatabaseType.WASM: {
      const { createWasmDatabaseInstance } = await import('./sqlite-wasm');
      return createWasmDatabaseInstance(path, enableTracing);
    }

    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
};

// Convenience functions for common use cases
export const createBunDatabase = async (
  path?: string,
  enableTracing?: boolean
): Promise<Database> =>
  createDatabase({
    enableTracing,
    path,
    type: DatabaseType.BUN
  });

export const createWasmDatabase = async (
  path?: string,
  enableTracing?: boolean
): Promise<Database> =>
  createDatabase({
    enableTracing,
    path,
    type: DatabaseType.WASM
  });

// Auto-detect function that tries Bun first, falls back to WASM
export const createAutoDatabase = async (
  path?: string,
  enableTracing?: boolean
): Promise<Database> => {
  try {
    return await createBunDatabase(path, enableTracing);
  } catch {
    // If Bun SQLite is not available, fall back to WASM
    return createWasmDatabase(path, enableTracing);
  }
};

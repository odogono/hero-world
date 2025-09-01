// Database type enum
export const DatabaseType = {
  ALASQL: 'alasql',
  BUN: 'bun',
  WASM: 'wasm'
} as const;

export type DatabaseType = (typeof DatabaseType)[keyof typeof DatabaseType];

// Options for database creation
export type CreateDatabaseOptions = {
  cacheSize?: number;
  clearExisting?: boolean;
  enableTracing?: boolean;
  pageSize?: number;
  path?: string | ':memory:';
  readonly?: boolean;
  type: DatabaseType;
  walMode?: 'WAL' | 'OFF';
};

export type LoadFromJSONOptions = {
  asComponents?: boolean;
};

export type SaveToJSONOptions = {
  asComponents?: boolean;
};

// Unified database interface
export type Database = {
  addEntity: () => number;
  close: () => void;
  exec: (sql: string, args?: StatementArgs, ...rest: StatementArgs[]) => void;
  loadFromJSON: (json: unknown, options?: LoadFromJSONOptions) => void;
  // lastInsertRowId: () => number;
  prepare: (sql: string) => Statement;
  query: (
    sql: string,
    args?: StatementArgs,
    ...rest: StatementArgs[]
  ) => unknown[];
  saveToJSON: (options?: SaveToJSONOptions) => unknown;
  saveToPath: (path: string) => void;
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
  iterate: (args?: StatementArgs) => unknown | null;
  run: (args?: StatementArgs) => StatementRunResult;
};

// Main database factory function
export const createDatabase = async (
  options: CreateDatabaseOptions
): Promise<Database> => {
  const { type } = options;
  switch (type) {
    case DatabaseType.ALASQL: {
      const { createAlasqlDatabaseInstance } = await import('./alasql');
      return createAlasqlDatabaseInstance(options);
    }

    case DatabaseType.BUN: {
      const { createBunDatabaseInstance } = await import('./bun-sqlite');
      return createBunDatabaseInstance(options);
    }

    case DatabaseType.WASM: {
      const { createWasmDatabaseInstance } = await import('./sqlite-wasm');
      return createWasmDatabaseInstance(options);
    }

    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
};

// Convenience functions for common use cases
export const createAlasqlDatabase = async (
  options: CreateDatabaseOptions
): Promise<Database> =>
  createDatabase({
    ...options,
    type: DatabaseType.ALASQL
  });

export const createBunDatabase = async (
  options: CreateDatabaseOptions
): Promise<Database> =>
  createDatabase({
    ...options,
    type: DatabaseType.BUN
  });

export const createWasmDatabase = async (
  options: CreateDatabaseOptions
): Promise<Database> =>
  createDatabase({
    ...options,
    type: DatabaseType.WASM
  });

// Auto-detect function that tries Bun first, falls back to WASM
export const createAutoDatabase = async (
  options: CreateDatabaseOptions
): Promise<Database> => {
  try {
    return await createBunDatabase(options);
  } catch {
    // If Bun SQLite is not available, fall back to WASM
    return createWasmDatabase(options);
  }
};

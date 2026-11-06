// Database type enum
export const DatabaseType = {
  BUN: 'bun',
  WASM: 'wasm'
} as const;

export type DatabaseType = (typeof DatabaseType)[keyof typeof DatabaseType];

// Options for database creation
export type CreateDatabaseOptions = {
  cacheSize?: number;
  clearExisting?: boolean;
  enableTracing?: boolean;
  /**
   * For `wasm`: keep the database in the Origin Private File System at
   * `path`, as a Local World's Worker does (ADR 0023). OPFS is only open to
   * a Worker; elsewhere opening fails.
   */
  opfs?: boolean;
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
  dump: () => string;
  exec: (sql: string, args?: StatementArgs, ...rest: StatementArgs[]) => void;
  /** The whole database as an SQLite file's bytes, for a save */
  export: () => Uint8Array;
  prepare: (sql: string) => Statement;
  query: (
    sql: string,
    args?: StatementArgs,
    ...rest: StatementArgs[]
  ) => unknown[];
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
    case DatabaseType.BUN: {
      const { createBunDatabaseInstance } = await import('./bun');
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

/** An SQLite file starts with these 16 bytes */
const SQLITE_HEADER = 'SQLite format 3\u0000';

/** Whether bytes are an SQLite database file, by its header */
export const isSqliteFile = (bytes: Uint8Array) =>
  bytes.length >= 100 &&
  new TextDecoder().decode(bytes.subarray(0, 16)) === SQLITE_HEADER;

/**
 * Puts an SQLite file's bytes in place of the database `options` names, as
 * loading a save does: a file on disk for `bun`, or a file in OPFS for
 * `wasm` with `opfs`. Close the database there first.
 */
export const replaceDatabase = async (
  options: CreateDatabaseOptions,
  bytes: Uint8Array
) => {
  if (!isSqliteFile(bytes)) {
    throw new Error('That is not an SQLite database file');
  }
  const { path } = options;
  if (!path || path === ':memory:') {
    throw new Error('Only a database kept in a file can be replaced');
  }
  if (options.type === DatabaseType.WASM && options.opfs) {
    const { importWasmDatabase } = await import('./sqlite-wasm');
    await importWasmDatabase(path, bytes);
    return;
  }
  if (options.type === DatabaseType.BUN) {
    const { replaceBunDatabase } = await import('./bun');
    replaceBunDatabase(path, bytes);
    return;
  }
  throw new Error('This database can not be replaced');
};

// Convenience functions for common use cases
export const createBunDatabase = async (
  options: Omit<CreateDatabaseOptions, 'type'> = {}
): Promise<Database> =>
  createDatabase({
    ...options,
    type: DatabaseType.BUN
  });

export const createWasmDatabase = async (
  options: Omit<CreateDatabaseOptions, 'type'> = {}
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

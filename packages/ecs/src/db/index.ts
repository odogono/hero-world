// Unified database interface
export type UnifiedDatabase = {
  close: () => void;
  exec: (sql: string) => void;
  lastInsertRowId: () => number;
  prepare: (sql: string) => UnifiedStatement;
  selectArray: (sql: string) => unknown[];
  selectArrays: (sql: string) => unknown[][];
  selectObjects: (sql: string) => unknown[];
  selectValue: (sql: string) => number;
};

export type UnifiedStatement = {
  bind: (args: unknown[]) => void;
  free: () => void;
  get: (args: unknown[]) => unknown[];
  getColumnNames: () => string[];
  step: () => boolean;
};

// Database type enum
export enum DatabaseType {
  BUN = 'bun',
  WASM = 'wasm'
}

// Options for database creation
export type CreateDatabaseOptions = {
  enableTracing?: boolean;
  path?: string;
  type: DatabaseType;
};

// Main database factory function
export const createDatabase = async function (
  options: CreateDatabaseOptions
): Promise<UnifiedDatabase> {
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
export const createBunDatabase = async function (
  path?: string,
  enableTracing?: boolean
): Promise<UnifiedDatabase> {
  return createDatabase({
    enableTracing,
    path,
    type: DatabaseType.BUN
  });
};

export const createWasmDatabase = async function (
  path?: string,
  enableTracing?: boolean
): Promise<UnifiedDatabase> {
  return createDatabase({
    enableTracing,
    path,
    type: DatabaseType.WASM
  });
};

// Auto-detect function that tries Bun first, falls back to WASM
export const createAutoDatabase = async function (
  path?: string,
  enableTracing?: boolean
): Promise<UnifiedDatabase> {
  try {
    return await createBunDatabase(path, enableTracing);
  } catch {
    // If Bun SQLite is not available, fall back to WASM
    return createWasmDatabase(path, enableTracing);
  }
};

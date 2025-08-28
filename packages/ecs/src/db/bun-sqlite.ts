import type { Database as BunDatabase } from 'bun:sqlite';

import type { UnifiedDatabase, UnifiedStatement } from './index';

// Wrapper for Bun SQLite database
export class BunDatabaseWrapper implements UnifiedDatabase {
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

  prepare(sql: string): UnifiedStatement {
    const stmt = this.db.prepare(sql);
    return {
      bind: (args: unknown[]) => {
        // Bun SQLite uses a different binding API
        if (args.length === 1) {
          stmt.bind(args[0]);
        } else {
          stmt.bind(args);
        }
      },
      free: () => stmt.finalize(),
      get: (args: unknown[]) => {
        if (args.length === 1) {
          return stmt.get(args[0]) as unknown[];
        }
        return stmt.get(args) as unknown[];
      },
      getColumnNames: () => stmt.columnNames,
      step: () => stmt.step()
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
    return this.db.lastInsertRowId;
  }
}

// Factory function for Bun SQLite
export const createBunDatabaseInstance = async (
  path: string
): Promise<UnifiedDatabase> => {
  const { Database } = await import('bun:sqlite');
  const db = new Database(path);
  return new BunDatabaseWrapper(db);
};

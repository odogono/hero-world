import type { CDef } from './types';

/**
 * Base error class for the ECS system
 */
export class ECSError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly isECSError = true;

  constructor(
    message: string,
    code: string = 'ECS_ERROR',
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ECSError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ECSError.prototype);
  }

  /**
   * Get a formatted error message with context
   */
  getFormattedMessage(): string {
    let formatted = `[${this.code}] ${this.message}`;

    if (this.context && Object.keys(this.context).length > 0) {
      const contextStr = Object.entries(this.context)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      formatted += ` (${contextStr})`;
    }

    return formatted;
  }

  /**
   * Get error details as a plain object for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      context: this.context,
      message: this.message,
      name: this.name,
      stack: this.stack,
      timestamp: this.timestamp.toISOString()
    };
  }
}

/**
 * SQLite-specific error class
 */
export class SQLiteError extends ECSError {
  public readonly sqliteCode?: number;
  public readonly sql?: string;
  public readonly args?: unknown[];

  constructor(
    message: string,
    options: {
      args?: unknown[];
      code?: string;
      context?: Record<string, unknown>;
      sql?: string;
      sqliteCode?: number;
    } = {}
  ) {
    const {
      args,
      code = 'SQLITE_ERROR',
      context = {},
      sql,
      sqliteCode
    } = options;

    // Add SQLite-specific context
    const sqliteContext = {
      ...context,
      ...(sqliteCode !== undefined && { sqliteCode }),
      ...(sql && { sql }),
      ...(args && { args })
    };

    super(message, code, sqliteContext);
    this.name = 'SQLiteError';
    this.sqliteCode = sqliteCode;
    this.sql = sql;
    this.args = args;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, SQLiteError.prototype);
  }

  /**
   * Create a SQLite error from a native SQLite error
   */
  static fromNativeError(
    error: Error | string,
    options: {
      context?: Record<string, unknown>;
      params?: unknown[];
      sql?: string;
      sqliteCode?: number;
    } = {}
  ): SQLiteError {
    const message = typeof error === 'string' ? error : error.message;
    return new SQLiteError(message, {
      code: 'SQLITE_NATIVE_ERROR',
      ...options
    });
  }

  /**
   * Create a SQLite constraint error
   */
  static constraintViolation(
    constraint: string,
    details?: string,
    options: {
      context?: Record<string, unknown>;
      params?: unknown[];
      sql?: string;
    } = {}
  ): SQLiteError {
    const message = details
      ? `Constraint violation: ${constraint} - ${details}`
      : `Constraint violation: ${constraint}`;

    return new SQLiteError(message, {
      code: 'SQLITE_CONSTRAINT_VIOLATION',
      context: { constraint, ...options.context },
      ...options
    });
  }

  /**
   * Create a SQLite syntax error
   */
  static syntaxError(
    sql: string,
    details?: string,
    options: {
      context?: Record<string, unknown>;
      params?: unknown[];
    } = {}
  ): SQLiteError {
    const message = details
      ? `SQL syntax error: ${details}`
      : 'SQL syntax error';

    return new SQLiteError(message, {
      code: 'SQLITE_SYNTAX_ERROR',
      context: { details, ...options.context },
      sql,
      ...options
    });
  }

  /**
   * Create a SQLite execution error
   */
  static executionError(
    sql: string,
    originalError: Error | string,
    options: {
      args?: unknown[];
      context?: Record<string, unknown>;
    } = {}
  ): SQLiteError {
    const message =
      typeof originalError === 'string' ? originalError : originalError.message;

    return new SQLiteError(message, {
      code: 'SQLITE_EXECUTION_ERROR',
      context: { originalError: originalError.toString(), ...options.context },
      sql,
      sqliteCode:
        originalError instanceof Error ? originalError.code : undefined,
      ...options
    });
  }

  /**
   * Get SQLite-specific error details
   */
  getSQLiteDetails(): Record<string, unknown> {
    return {
      args: this.args,
      sql: this.sql,
      sqliteCode: this.sqliteCode,
      ...this.context
    };
  }
}

/**
 * Common ECS error codes
 */
export const ECSErrorCodes = {
  // General ECS errors
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  DUPLICATE_COMPONENT_DEFINITION: 'DUPLICATE_COMPONENT_DEFINITION',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  INVALID_COMPONENT_DEFINITION: 'INVALID_COMPONENT_DEFINITION',
  INVALID_ENTITY_ID: 'INVALID_ENTITY_ID',
  SYSTEM_NOT_FOUND: 'SYSTEM_NOT_FOUND',
  WORLD_NOT_INITIALIZED: 'WORLD_NOT_INITIALIZED',

  // Database errors
  DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
  DATABASE_NOT_INITIALIZED: 'DATABASE_NOT_INITIALIZED',
  UNSUPPORTED_DATABASE_TYPE: 'UNSUPPORTED_DATABASE_TYPE',

  // Query errors
  INVALID_QUERY: 'INVALID_QUERY',
  QUERY_EXECUTION_FAILED: 'QUERY_EXECUTION_FAILED',

  // Schema errors
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',

  // Event errors
  EVENT_HANDLER_FAILED: 'EVENT_HANDLER_FAILED',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND'
} as const;

/**
 * Common SQLite error codes
 */
export const SQLiteErrorCodes = {
  // SQLite specific errors
  SQLITE_ABORT: 'SQLITE_ABORT',
  SQLITE_AUTH: 'SQLITE_AUTH',
  SQLITE_BUSY: 'SQLITE_BUSY',
  SQLITE_CANTOPEN: 'SQLITE_CANTOPEN',
  SQLITE_CONSTRAINT: 'SQLITE_CONSTRAINT',
  SQLITE_CORRUPT: 'SQLITE_CORRUPT',
  SQLITE_DONE: 'SQLITE_DONE',
  SQLITE_EMPTY: 'SQLITE_EMPTY',
  SQLITE_ERROR: 'SQLITE_ERROR',
  SQLITE_FORMAT: 'SQLITE_FORMAT',
  SQLITE_FULL: 'SQLITE_FULL',
  SQLITE_INTERNAL: 'SQLITE_INTERNAL',
  SQLITE_INTERRUPT: 'SQLITE_INTERRUPT',
  SQLITE_IOERR: 'SQLITE_IOERR',
  SQLITE_LOCKED: 'SQLITE_LOCKED',
  SQLITE_MISMATCH: 'SQLITE_MISMATCH',
  SQLITE_MISUSE: 'SQLITE_MISUSE',
  SQLITE_NOLFS: 'SQLITE_NOLFS',
  SQLITE_NOMEM: 'SQLITE_NOMEM',
  SQLITE_NOTADB: 'SQLITE_NOTADB',
  SQLITE_NOTFOUND: 'SQLITE_NOTFOUND',
  SQLITE_NOTICE: 'SQLITE_NOTICE',
  SQLITE_PERM: 'SQLITE_PERM',
  SQLITE_PROTOCOL: 'SQLITE_PROTOCOL',
  SQLITE_RANGE: 'SQLITE_RANGE',
  SQLITE_READONLY: 'SQLITE_READONLY',
  SQLITE_ROW: 'SQLITE_ROW',
  SQLITE_SCHEMA: 'SQLITE_SCHEMA',
  SQLITE_TOOBIG: 'SQLITE_TOOBIG',
  SQLITE_WARNING: 'SQLITE_WARNING'
} as const;

/**
 * Type guard to check if an error is an ECSError
 */
export const isECSError = (error: unknown): error is ECSError =>
  error instanceof ECSError || (error as ECSError)?.isECSError === true;

/**
 * Type guard to check if an error is a SQLiteError
 */
export const isSQLiteError = (error: unknown): error is SQLiteError =>
  error instanceof SQLiteError;

/**
 * Helper function to create a component not found error
 */
export const createComponentNotFoundError = (
  componentId: string | symbol,
  entityId?: number
): ECSError =>
  new ECSError(
    `Component definition not found for ${String(componentId)}`,
    ECSErrorCodes.COMPONENT_NOT_FOUND,
    { componentId: String(componentId), entityId }
  );

/**
 * Helper function to create an entity not found error
 */
export const createEntityNotFoundError = (entityId: number): ECSError =>
  new ECSError(
    `Entity not found with ID: ${entityId}`,
    ECSErrorCodes.ENTITY_NOT_FOUND,
    { entityId }
  );

/**
 * Helper function to create a world not initialized error
 */
export const createWorldNotInitializedError = (): ECSError =>
  new ECSError(
    'World has not been initialized',
    ECSErrorCodes.WORLD_NOT_INITIALIZED
  );

export const createDuplicateComponentDefinitionError = (
  componentDef: CDef
): ECSError =>
  new ECSError(
    `Duplicate component definition for '${componentDef.id}'`,
    ECSErrorCodes.DUPLICATE_COMPONENT_DEFINITION,
    { componentId: componentDef.id, hash: componentDef.hash }
  );

export const createSqliteError = (
  error: unknown,
  sql: string,
  options: {
    context?: Record<string, unknown>;
    params?: unknown[];
    sqliteCode?: number;
  }
): SQLiteError =>
  SQLiteError.executionError(sql, error as Error | string, {
    ...options
  });

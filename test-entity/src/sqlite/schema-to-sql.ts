import * as z from "zod";
import { toSnakeCase } from '@helpers/string';

/**
 * Column information for SQLite table generation
 */
export interface ColumnInfo {
  name: string;
  type: string;
  constraints: string[];
}

/**
 * Result of converting a Zod schema to SQLite table
 */
export interface TableGenerationResult {
  sql: string;
  columns: ColumnInfo[];
  tableName: string;
}


export interface ZodSchemaToSqliteTableOptions {
  tableName?: string;
  ifNotExists?: boolean;
}

/**
 * Converts a Zod schema to a SQLite CREATE TABLE statement
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @returns Object containing SQL statement, column details, and table name
 */
export function zodSchemaToSqliteTable(
  schema: z.ZodObject<any>, 
  options?: ZodSchemaToSqliteTableOptions
): TableGenerationResult {
  const shape = schema.shape;
  const columnDefs: string[] = [];
  const columnInfos: ColumnInfo[] = [];
  
  // Get table name from metadata or options
  const tableName = options?.tableName || (schema.meta()?.name as string);
  const ifNotExists = options?.ifNotExists || false;
  
  if (!tableName) {
    throw new Error('Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter');
  }
  
  for (const [key, value] of Object.entries(shape)) {
    const snakeCaseKey = toSnakeCase(key) || key;
    const { columnDef, columnInfo } = zodTypeToSqliteColumnWithInfo(snakeCaseKey, value as z.ZodTypeAny);
    columnDefs.push(columnDef);
    columnInfos.push(columnInfo);
  }
  
  const sql = `CREATE TABLE${ifNotExists ? ' IF NOT EXISTS ' : ' '}${tableName} (\n  ${columnDefs.join(',\n  ')}\n);`;
  
  return {
    sql,
    columns: columnInfos,
    tableName
  };
}

/**
 * Converts a Zod type to a SQLite column definition with detailed information
 * @param columnName - The name of the column
 * @param zodType - The Zod type to convert
 * @param isOptional - Whether the field is optional (internal use)
 * @returns Object containing SQL column definition and column information
 */
function zodTypeToSqliteColumnWithInfo(columnName: string, zodType: z.ZodTypeAny, isOptional = false): { columnDef: string; columnInfo: ColumnInfo } {
  let sqliteType = 'TEXT'; // default
  let constraints: string[] = [];
  
  // Handle different Zod types
  if (zodType instanceof z.ZodNumber) {
    sqliteType = 'REAL';
    // Check if it's specifically an integer
    if (zodType._def.checks?.some((check: any) => check.kind === 'int')) {
      sqliteType = 'INTEGER';
    }
    // Check for integer format in checks
    if (zodType._def.checks?.some((check: any) => check._def?.format === 'safeint' || check._def?.isInt === true)) {
      sqliteType = 'INTEGER';
    }
    // Also check for ZodInt specifically
    if (zodType.constructor.name === 'ZodInt') {
      sqliteType = 'INTEGER';
    }
    // Check for format property in _def for z.int() and z.int32()
    const format = (zodType._def as any)?.format;
    if (format === 'safeint' || format === 'int32') {
      sqliteType = 'INTEGER';
    }
  } else if (zodType.constructor.name === 'ZodNumberFormat') {
    // Handle z.int() and z.int32() types
    const format = (zodType._def as any)?.format;
    if (format === 'safeint' || format === 'int32') {
      sqliteType = 'INTEGER';
    } else {
      sqliteType = 'REAL';
    }
  } else if (zodType instanceof z.ZodString) {
    sqliteType = 'TEXT';
  } else if (zodType instanceof z.ZodBoolean) {
    sqliteType = 'INTEGER'; // SQLite doesn't have BOOLEAN, uses INTEGER (0/1)
  } else if (zodType instanceof z.ZodDate) {
    sqliteType = 'TEXT'; // Store as ISO string
  } else if (zodType.constructor.name === 'ZodISODateTime') {
    sqliteType = 'DATETIME'; // Handle z.iso.datetime()
  } else if (zodType instanceof z.ZodEnum) {
    sqliteType = 'TEXT';
  } else if (zodType instanceof z.ZodLiteral) {
    // For literal values, we need to determine the type from the value
    const literalValue = (zodType._def as any).value;
    if (typeof literalValue === 'number') {
      sqliteType = Number.isInteger(literalValue) ? 'INTEGER' : 'REAL';
    } else if (typeof literalValue === 'boolean') {
      sqliteType = 'INTEGER';
    } else {
      sqliteType = 'TEXT';
    }
  } else if (zodType instanceof z.ZodUnion) {
    // For unions, we'll use TEXT as it can handle multiple types
    sqliteType = 'TEXT';
  } else if (zodType instanceof z.ZodOptional) {
    // Check metadata before unwrapping
    const metadata = zodType.meta();
    const unwrappedType = zodType.unwrap() as z.ZodTypeAny;
    
    // If this optional field has primary key metadata, we need to handle it specially
    if (metadata?.primaryKey) {
      let sqliteType = 'INTEGER';
      let constraints: string[] = ['PRIMARY KEY'];
      
      if (metadata?.autoIncrement) {
        constraints.push('AUTOINCREMENT');
      }
      
      // Primary keys should always be NOT NULL
      constraints.push('NOT NULL');
      
      const columnDef = `${columnName} ${sqliteType} ${constraints.join(' ')}`;
      return {
        columnDef,
        columnInfo: {
          name: columnName,
          type: sqliteType,
          constraints: [...constraints]
        }
      };
    }
    
    // Optional fields are nullable by default
    return zodTypeToSqliteColumnWithInfo(columnName, unwrappedType, true);
  } else if (zodType instanceof z.ZodNullable) {
    return zodTypeToSqliteColumnWithInfo(columnName, zodType.unwrap() as z.ZodTypeAny, true);
  } else if (zodType instanceof z.ZodDefault) {
    // Default values will be handled by the application layer
    return zodTypeToSqliteColumnWithInfo(columnName, zodType.removeDefault() as z.ZodTypeAny, isOptional);
  }
  
  // Handle special cases for common field names
  if (columnName === 'created_at' || columnName === 'updated_at') {
    // Check if it's a DATETIME type and update accordingly
    if (sqliteType === 'DATETIME') {
      // Keep as DATETIME for iso.datetime fields
    } else {
      sqliteType = 'TEXT'; // ISO datetime string for regular date fields
    }
  }
  
  // Check for primary key in metadata
  const metadata = zodType.meta();
  if (metadata?.primaryKey) {
    sqliteType = 'INTEGER';
    constraints.push('PRIMARY KEY');
    if (metadata?.autoIncrement) {
      constraints.push('AUTOINCREMENT');
    }
    // Primary keys should always be NOT NULL, even if the field is optional
    isOptional = false;
  }
  
  // Check for default value in metadata
  if (metadata?.default) {
    constraints.push(`DEFAULT ${metadata.default}`);
  }
  
  // Add NOT NULL constraint for non-optional fields
  if (!isOptional) {
    constraints.push('NOT NULL');
  }
  
  // Order constraints properly: NOT NULL first, then PRIMARY KEY, then AUTOINCREMENT, then DEFAULT
  const orderedConstraints = [];
  if (constraints.includes('NOT NULL')) {
    orderedConstraints.push('NOT NULL');
  }
  if (constraints.includes('PRIMARY KEY')) {
    orderedConstraints.push('PRIMARY KEY');
  }
  if (constraints.includes('AUTOINCREMENT')) {
    orderedConstraints.push('AUTOINCREMENT');
  }
  // Find and add DEFAULT constraint
  const defaultConstraint = constraints.find(c => c.startsWith('DEFAULT'));
  if (defaultConstraint) {
    orderedConstraints.push(defaultConstraint);
  }
  
  // For optional fields, explicitly add NULL constraint
  if (isOptional && !constraints.includes('PRIMARY KEY')) {
    orderedConstraints.push('NULL');
  }
  
  const columnDef = `${columnName} ${sqliteType}${orderedConstraints.length > 0 ? ' ' + orderedConstraints.join(' ') : ''}`;
  return {
    columnDef,
    columnInfo: {
      name: columnName,
      type: sqliteType,
      constraints: [...orderedConstraints]
    }
  };
}

/**
 * Converts a Zod type to a SQLite column definition (backward compatibility)
 * @param columnName - The name of the column
 * @param zodType - The Zod type to convert
 * @param isOptional - Whether the field is optional (internal use)
 * @returns SQLite column definition as a string
 */
function zodTypeToSqliteColumn(columnName: string, zodType: z.ZodTypeAny, isOptional = false): string {
  const result = zodTypeToSqliteColumnWithInfo(columnName, zodType, isOptional);
  return result.columnDef;
}

/**
 * Converts a Zod schema to a SQLite INSERT statement
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @returns SQLite INSERT statement as a string
 */
export function zodSchemaToSqliteInsert(
  schema: z.ZodObject<any>,
  options?: { tableName?: string }
): string {
  const shape = schema.shape;
  const columns: string[] = [];
  const placeholders: string[] = [];
  
  // Get table name from metadata or options
  const tableName = options?.tableName || schema.meta()?.name;
  
  if (!tableName) {
    throw new Error('Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter');
  }
  
  let placeholderIndex = 1;
  for (const [key, value] of Object.entries(shape)) {
    // Check if this column has autoIncrement metadata
    const metadata = (value as z.ZodTypeAny).meta();
    if (metadata?.autoIncrement) {
      // Skip auto-increment columns as they will be generated by SQLite
      continue;
    }
    
    const snakeCaseKey = toSnakeCase(key) || key;
    columns.push(snakeCaseKey);
    placeholders.push(`?${placeholderIndex}`);
    placeholderIndex++;
  }
  
  return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
}

/**
 * Converts a Zod schema to a SQLite SELECT statement
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @returns SQLite SELECT statement as a string
 */
export function zodSchemaToSqliteSelect(
  schema: z.ZodObject<any>,
  options?: { tableName?: string }
): string {
  const shape = schema.shape;
  const columns: string[] = [];
  
  // Get table name from metadata or options
  const tableName = options?.tableName || schema.meta()?.name;
  
  if (!tableName) {
    throw new Error('Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter');
  }
  
  for (const [key, value] of Object.entries(shape)) {
    const snakeCaseKey = toSnakeCase(key) || key;
    columns.push(snakeCaseKey);
  }
  
  return `SELECT ${columns.join(', ')} FROM ${tableName}`;
}

/**
 * Type helper for extracting the inferred type from a Zod schema
 */
export type InferTableSchema<T extends z.ZodObject<any>> = z.infer<T>;

// Re-export the old function for backward compatibility
export function zodSchemaToSqliteTableString(
  schema: z.ZodObject<any>, 
  options?: { tableName?: string }
): string {
  const result = zodSchemaToSqliteTable(schema, options);
  return result.sql;
}

import * as z from "zod";
import { toSnakeCase } from '@helpers/string';
import type { SchemaType } from '../types';

/**
 * Column information for SQLite table generation
 */
export type ColumnInfo = {
  constraints: string[];
  name: string;
  type: string;
}

/**
 * Index information for SQLite index generation
 */
export type IndexInfo = {
  columns: string[];
  name: string;
  unique: boolean;
  tableName: string;
}

/**
 * Result of converting a Zod schema to SQLite table
 */
export type TableGenerationResult = {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  sql: string;
  tableName: string;
}

/**
 * Result of converting a Zod schema to SQLite indexes
 */
export type IndexGenerationResult = {
  indexes: IndexInfo[];
  sql: string[];
}

export type ZodSchemaToSqliteTableOptions = {
  ifNotExists?: boolean;
  tableName?: string;
}

/**
 * Converts a Zod schema to a SQLite CREATE TABLE statement
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @returns Object containing SQL statement, column details, and table name
 */
export function zodSchemaToSqliteTable(
  schema: SchemaType, 
  options?: ZodSchemaToSqliteTableOptions
): TableGenerationResult {
  const shape = schema.shape;
  const columnDefs: string[] = [];
  const columnInfos: ColumnInfo[] = [];
  const foreignKeyConstraints: string[] = [];
  const indexInfos: IndexInfo[] = [];
  
  // Get table name from metadata or options
  const tableName = options?.tableName || (schema.meta()?.name as string);
  const ifNotExists = options?.ifNotExists ?? true; // Default to true
  
  if (!tableName) {
    throw new Error('Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter');
  }
  
  for (const [key, value] of Object.entries(shape)) {
    const snakeCaseKey = toSnakeCase(key) || key;
    const { columnDef, columnInfo, foreignKeyConstraint } = zodTypeToSqliteColumnWithInfo(snakeCaseKey, value as z.ZodTypeAny);
    columnDefs.push(columnDef);
    columnInfos.push(columnInfo);
    
    // Collect foreign key constraints
    if (foreignKeyConstraint) {
      foreignKeyConstraints.push(foreignKeyConstraint);
    }
    
    // Collect single-column indexes from field metadata
    const metadata = (value as z.ZodTypeAny).meta();
    if (metadata && typeof metadata === 'object' && 'index' in metadata && metadata.index) {
      const indexName = (metadata.indexName as string) || `idx_${tableName}_${snakeCaseKey}`;
      indexInfos.push({
        columns: [snakeCaseKey],
        name: indexName,
        tableName,
        unique: (metadata.indexUnique as boolean) || false
      });
    }
  }
  
  // Collect composite indexes from schema metadata
  const schemaMetadata = schema.meta();
  if (schemaMetadata && typeof schemaMetadata === 'object' && 'indexes' in schemaMetadata && Array.isArray(schemaMetadata.indexes)) {
    for (const indexDef of schemaMetadata.indexes as Array<{name?: string; columns: string[]; unique?: boolean}>) {
      const snakeCaseColumns = indexDef.columns.map((col: string) => toSnakeCase(col) || col);
      const indexName = indexDef.name || `idx_${tableName}_${snakeCaseColumns.join('_')}`;
      indexInfos.push({
        columns: snakeCaseColumns,
        name: indexName,
        tableName,
        unique: indexDef.unique || false
      });
    }
  }
  
  // Combine column definitions with foreign key constraints
  const allConstraints = [...columnDefs, ...foreignKeyConstraints];
  const sql = `CREATE TABLE${ifNotExists ? ' IF NOT EXISTS ' : ' '}${tableName} (\n  ${allConstraints.join(',\n  ')}\n);`;
  
  return {
    columns: columnInfos,
    indexes: indexInfos,
    sql,
    tableName
  };
}

/**
 * Converts a Zod schema to SQLite CREATE INDEX statements
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @param options.ifNotExists - Add IF NOT EXISTS to index creation
 * @returns Object containing index information and SQL statements
 */
export function zodSchemaToSqliteIndexes(
  schema: SchemaType,
  options?: ZodSchemaToSqliteTableOptions
): IndexGenerationResult {
  const tableResult = zodSchemaToSqliteTable(schema, options);
  const indexSql: string[] = [];
  
  for (const indexInfo of tableResult.indexes) {
    const uniqueClause = indexInfo.unique ? 'UNIQUE ' : '';
    const ifNotExists = (options?.ifNotExists ?? true) ? 'IF NOT EXISTS ' : '';
    const sql = `CREATE ${uniqueClause}INDEX ${ifNotExists}${indexInfo.name} ON ${indexInfo.tableName} (${indexInfo.columns.join(', ')});`;
    indexSql.push(sql);
  }
  
  return {
    indexes: tableResult.indexes,
    sql: indexSql
  };
}

/**
 * Converts a Zod schema to a complete SQLite schema (table + indexes)
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @returns Array of SQL statements for table and index creation
 */
export function zodSchemaToSqliteSchema(
  schema: SchemaType,
  options?: ZodSchemaToSqliteTableOptions
): string[] {
  const tableResult = zodSchemaToSqliteTable(schema, options);
  const indexResult = zodSchemaToSqliteIndexes(schema, options);
  
  return [tableResult.sql, ...indexResult.sql];
}

/**
 * Converts a Zod type to a SQLite column definition with detailed information
 * @param columnName - The name of the column
 * @param zodType - The Zod type to convert
 * @param isOptional - Whether the field is optional (internal use)
 * @returns Object containing SQL column definition and column information
 */
function zodTypeToSqliteColumnWithInfo(columnName: string, zodType: z.ZodTypeAny, isOptional = false): { columnDef: string; columnInfo: ColumnInfo; foreignKeyConstraint?: string } {
  let sqliteType = 'TEXT'; // default
  const constraints: string[] = [];
  
  // Handle different Zod types
  if (zodType instanceof z.ZodNumber) {
    sqliteType = 'REAL';
    // Check if it's specifically an integer
    if (zodType.def.checks?.some((check: any) => check.kind === 'int')) {
      sqliteType = 'INTEGER';
    }
    // Check for integer format in checks
    if (zodType.def.checks?.some((check: any) => check._def?.format === 'safeint' || check._def?.isInt === true)) {
      sqliteType = 'INTEGER';
    }
    // Also check for ZodInt specifically
    if (zodType.constructor.name === 'ZodInt') {
      sqliteType = 'INTEGER';
    }
    // Check for format property in _def for z.int() and z.int32()
    const format = (zodType.def as any)?.format;
    if (format === 'safeint' || format === 'int32') {
      sqliteType = 'INTEGER';
    }
  } else if (zodType.constructor.name === 'ZodNumberFormat') {
    // Handle z.int() and z.int32() types
    const format = (zodType.def as any)?.format;
    sqliteType = format === 'safeint' || format === 'int32' ? 'INTEGER' : 'REAL';
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
    const literalValue = (zodType.def as any).value;
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
      const sqliteType = 'INTEGER';
      const constraints: string[] = ['PRIMARY KEY'];
      
      if (metadata?.autoIncrement) {
        constraints.push('AUTOINCREMENT');
      }
      
      // Primary keys should always be NOT NULL
      constraints.push('NOT NULL');
      
      const columnDef = `${columnName} ${sqliteType} ${constraints.join(' ')}`;
      return {
        columnDef,
        columnInfo: {
          constraints: [...constraints],
          name: columnName,
          type: sqliteType
        }
      };
    }
    
    // For optional fields with other metadata (like foreignKey), we need to preserve the metadata
    // by merging it with the unwrapped type's metadata
    if (metadata && Object.keys(metadata).length > 0) {
      const unwrappedMetadata = unwrappedType.meta() || {};
      const mergedMetadata = { ...unwrappedMetadata, ...metadata };
      const typeWithMetadata = unwrappedType.meta(mergedMetadata);
      return zodTypeToSqliteColumnWithInfo(columnName, typeWithMetadata, true);
    }
    
    // Optional fields are nullable by default
    return zodTypeToSqliteColumnWithInfo(columnName, unwrappedType, true);
  } else if (zodType instanceof z.ZodNullable) {
    return zodTypeToSqliteColumnWithInfo(columnName, zodType.unwrap() as z.ZodTypeAny, true);
  } else if (zodType instanceof z.ZodDefault) {
    // Extract the default value and the underlying type
    const defaultValue = (zodType._def as any).defaultValue;
    const innerType = zodType.removeDefault() as z.ZodTypeAny;
    
    // Process the inner type first
    const result = zodTypeToSqliteColumnWithInfo(columnName, innerType, isOptional);
    
    // Add the default value constraint
    let defaultConstraint: string;
    if (typeof defaultValue === 'string') {
      defaultConstraint = `DEFAULT '${defaultValue}'`;
    } else if (typeof defaultValue === 'boolean') {
      defaultConstraint = `DEFAULT ${defaultValue ? '1' : '0'}`;
    } else if (typeof defaultValue === 'number') {
      defaultConstraint = `DEFAULT ${defaultValue}`;
    } else {
      // For other types, convert to string representation
      defaultConstraint = `DEFAULT '${String(defaultValue)}'`;
    }
    
    // Add the default constraint to the column definition
    const columnDef = result.columnDef + ' ' + defaultConstraint;
    
    return {
      columnDef,
      columnInfo: {
        ...result.columnInfo,
        constraints: [...result.columnInfo.constraints, defaultConstraint]
      },
      foreignKeyConstraint: result.foreignKeyConstraint
    };
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
  
  // Check for unique constraint in metadata
  if (metadata?.unique) {
    constraints.push('UNIQUE');
  }
  
  // Check for default value in metadata
  if (metadata?.default) {
    constraints.push(`DEFAULT ${metadata.default}`);
  }
  
  // Add NOT NULL constraint for non-optional fields
  if (!isOptional) {
    constraints.push('NOT NULL');
  }
  
  // Handle foreign key constraint
  let foreignKeyConstraint: string | undefined;
  if (metadata?.foreignKey) {
    const referencedTable = metadata.foreignKey;
    const cascade = metadata.cascade ? ' ON DELETE CASCADE' : '';
    foreignKeyConstraint = `FOREIGN KEY (${columnName}) REFERENCES ${referencedTable} (id)${cascade}`;
    
    // Foreign key columns should be INTEGER type
    sqliteType = 'INTEGER';
  }
  
  // Order constraints properly: NOT NULL first, then PRIMARY KEY, then AUTOINCREMENT, then UNIQUE, then DEFAULT
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
  if (constraints.includes('UNIQUE')) {
    orderedConstraints.push('UNIQUE');
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
      constraints: [...orderedConstraints],
      name: columnName,
      type: sqliteType
    },
    foreignKeyConstraint
  };
}


type StatementOptions = {
  namedParams?: boolean;
  tableName?: string;
}

/**
 * Converts a Zod schema to a SQLite INSERT statement
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @returns SQLite INSERT statement as a string
 */
export const zodSchemaToSqliteInsert = (
  schema: SchemaType,
  options?: StatementOptions
): string => {
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
    placeholders.push(options?.namedParams ? `:${snakeCaseKey}` : `?${placeholderIndex}`);
    placeholderIndex++;
  }
  
  return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
}


export const zodSchemaToSqliteUpdate = (schema: SchemaType, options?: StatementOptions): string => {
  const shape = schema.shape;
  const columns: string[] = [];
  const placeholders: string[] = [];

  const tableName = options?.tableName || schema.meta()?.name;
  
  if (!tableName) {
    throw new Error('Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter');
  }

  let placeholderIndex = 1;

  for (const [key, value] of Object.entries(shape)) {
    if (key === 'eid') {
      continue;
    }
    
    // Check if this column has autoIncrement metadata
    const metadata = (value as z.ZodTypeAny).meta();
    if (metadata?.autoIncrement) {
      // Skip auto-increment columns as they will be generated by SQLite
      continue;
    }


    const snakeCaseKey = toSnakeCase(key) || key;
    columns.push(snakeCaseKey);
    placeholders.push(options?.namedParams ? `:${snakeCaseKey}` : `?${placeholderIndex}`);
    placeholderIndex++;
  }
  
  return `UPDATE ${tableName} SET (${columns.join(', ')}) = (${placeholders.join(', ')}) WHERE eid = ${options?.namedParams ? ':eid' : '?'}`;
}


/**
 * Converts a Zod schema to a SQLite SELECT statement
 * @param schema - The Zod schema to convert
 * @param options - Optional configuration
 * @param options.tableName - Override table name from schema metadata
 * @returns SQLite SELECT statement as a string
 */
export const zodSchemaToSqliteSelect = (
  schema: SchemaType,
  options?: { tableName?: string }
): string => {
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
 * Converts a Zod schema to a SQLite SELECT statement with WHERE clause
 * @param tableResult - The result from zodSchemaToSqliteTable
 * @param selectColumn - The column to select (in snake_case)
 * @param whereColumn - The column(s) to filter by (in snake_case)
 * @returns SQLite SELECT statement with WHERE clause as a string
 */
export const zodSchemaToSqliteSelectWhere = (
  tableResult: TableGenerationResult,
  selectColumn: string,
  whereColumn: string | string[]
): string => {
  const tableName = tableResult.tableName;
  const whereColumns = Array.isArray(whereColumn) ? whereColumn : [whereColumn];
  
  // Build WHERE clause with AND conditions
  const whereConditions = whereColumns.map((col, index) => `${col} = ?${index + 1}`);
  const whereClause = whereConditions.join(' AND ');
  
  return `SELECT ${selectColumn} FROM ${tableName} WHERE ${whereClause}`;
}

/**
 * Type helper for extracting the inferred type from a Zod schema
 */
export type InferTableSchema<T extends SchemaType> = z.infer<T>;

// Re-export the old function for backward compatibility
export const zodSchemaToSqliteTableString = (
  schema: SchemaType, 
  options?: { tableName?: string }
): string => {
  const result = zodSchemaToSqliteTable(schema, options);
  return result.sql;
}

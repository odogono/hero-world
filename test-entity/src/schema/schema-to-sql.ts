/* eslint-disable @nkzw/no-instanceof */
import { z } from 'zod';

import { toSnakeCase } from '@helpers/string';

import type {
  ColumnInfo,
  IndexGenerationResult,
  IndexInfo,
  SchemaType,
  StatementOptions,
  TableGenerationResult,
  ZodSchemaToSqliteTableOptions
} from './types';

/**
 * Helper function to get table name with validation
 */
const getTableName = (
  schema: SchemaType,
  options?: { tableName?: string }
): string => {
  const tableName = options?.tableName || (schema.meta()?.name as string);
  if (!tableName) {
    throw new Error(
      'Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter'
    );
  }
  return tableName;
};

/**
 * Helper function to determine SQLite type from Zod type
 */
const getSqliteType = (zodType: z.ZodTypeAny): string => {
  // Handle number types
  if (zodType instanceof z.ZodNumber) {
    switch (zodType.format) {
      case 'safeint':
      case 'int32':
      case 'int64':
        return 'INTEGER';
      default:
        return 'REAL';
    }
  }

  // Handle other basic types
  if (zodType instanceof z.ZodString) {
    return 'TEXT';
  }
  if (zodType instanceof z.ZodBoolean) {
    return 'INTEGER';
  }
  if (zodType instanceof z.ZodDate) {
    return 'TEXT';
  }
  if (zodType.constructor.name === 'ZodISODateTime') {
    return 'DATETIME';
  }
  if (zodType instanceof z.ZodEnum) {
    return 'TEXT';
  }
  if (zodType instanceof z.ZodUnion) {
    return 'TEXT';
  }

  // Handle literal values
  if (zodType instanceof z.ZodLiteral) {
    const literalValue = zodType.value;
    if (typeof literalValue === 'number') {
      return Number.isInteger(literalValue) ? 'INTEGER' : 'REAL';
    }
    if (typeof literalValue === 'boolean') {
      return 'INTEGER';
    }
    return 'TEXT';
  }

  return 'TEXT'; // default
};

/**
 * Helper function to order constraints properly
 */
const orderConstraints = (
  constraints: string[],
  isOptional: boolean
): string[] => {
  const ordered: string[] = [];

  // Add PRIMARY KEY first
  if (constraints.includes('PRIMARY KEY')) {
    ordered.push('PRIMARY KEY');
  }

  // Add AUTOINCREMENT after PRIMARY KEY
  if (constraints.includes('AUTOINCREMENT')) {
    ordered.push('AUTOINCREMENT');
  }

  // Add NOT NULL after AUTOINCREMENT
  if (constraints.includes('NOT NULL')) {
    ordered.push('NOT NULL');
  }

  // Add UNIQUE
  if (constraints.includes('UNIQUE')) {
    ordered.push('UNIQUE');
  }

  // Add DEFAULT constraint (should be last)
  const defaultConstraint = constraints.find(c => c.startsWith('DEFAULT'));
  if (defaultConstraint) {
    ordered.push(defaultConstraint);
  }

  // Add NULL for optional fields (unless it's a primary key)
  if (isOptional && !constraints.includes('PRIMARY KEY')) {
    ordered.push('NULL');
  }

  return ordered;
};

/**
 * Converts a Zod type to a SQLite column definition with detailed information
 */
const zodTypeToSqliteColumnWithInfo = (
  columnName: string,
  zodType: z.ZodTypeAny,
  isOptional = false
): {
  columnDef: string;
  columnInfo: ColumnInfo;
  foreignKeyConstraint?: string;
} => {
  let sqliteType = getSqliteType(zodType);
  const constraints: string[] = [];
  let foreignKeyConstraint: string | undefined;

  // Handle optional types
  if (zodType instanceof z.ZodOptional) {
    const metadata = zodType.meta();
    const unwrappedType = zodType.unwrap() as z.ZodTypeAny;

    // Handle primary key in optional fields
    if (metadata?.primaryKey) {
      sqliteType = 'INTEGER';
      constraints.push('PRIMARY KEY');
      if (metadata?.autoIncrement) {
        constraints.push('AUTOINCREMENT');
      }
      // Don't add NOT NULL for primary keys since they are inherently NOT NULL
      isOptional = false;
    } else if (metadata && Object.keys(metadata).length > 0) {
      // Merge metadata with unwrapped type
      const unwrappedMetadata = unwrappedType.meta() || {};
      const mergedMetadata = { ...unwrappedMetadata, ...metadata };
      const typeWithMetadata = unwrappedType.meta(mergedMetadata);
      return zodTypeToSqliteColumnWithInfo(columnName, typeWithMetadata, true);
    } else {
      return zodTypeToSqliteColumnWithInfo(columnName, unwrappedType, true);
    }
  } else if (zodType instanceof z.ZodNullable) {
    return zodTypeToSqliteColumnWithInfo(
      columnName,
      zodType.unwrap() as z.ZodTypeAny,
      true
    );
  } else if (zodType instanceof z.ZodDefault) {
    // Handle default values
    const defaultValue = zodType.def.defaultValue;
    const innerType = zodType.unwrap() as z.ZodTypeAny;
    const result = zodTypeToSqliteColumnWithInfo(
      columnName,
      innerType,
      isOptional
    );

    let defaultConstraint: string;
    if (typeof defaultValue === 'string') {
      defaultConstraint =
        defaultValue === 'CURRENT_TIMESTAMP'
          ? `DEFAULT CURRENT_TIMESTAMP`
          : `DEFAULT '${defaultValue}'`;
    } else if (typeof defaultValue === 'boolean') {
      defaultConstraint = `DEFAULT ${defaultValue ? '1' : '0'}`;
    } else if (typeof defaultValue === 'number') {
      defaultConstraint = `DEFAULT ${defaultValue}`;
    } else {
      defaultConstraint = `DEFAULT '${String(defaultValue)}'`;
    }

    return {
      columnDef: result.columnDef + ' ' + defaultConstraint,
      columnInfo: {
        ...result.columnInfo,
        constraints: [...result.columnInfo.constraints, defaultConstraint]
      },
      foreignKeyConstraint: result.foreignKeyConstraint
    };
  }

  // Handle special cases for timestamp fields
  if (
    (columnName === 'created_at' || columnName === 'updated_at') &&
    sqliteType !== 'DATETIME'
  ) {
    sqliteType = 'TEXT';
  }

  // Process metadata
  const metadata = zodType.meta();
  if (metadata?.primaryKey) {
    constraints.push('PRIMARY KEY');
    if (metadata?.autoIncrement) {
      sqliteType = 'INTEGER';
      constraints.push('AUTOINCREMENT');
    }
    isOptional = false;
  }

  if (metadata?.unique) {
    constraints.push('UNIQUE');
  }

  // Only add NOT NULL if not optional and not a primary key (since primary keys are inherently NOT NULL)
  if (!isOptional && !metadata?.primaryKey) {
    constraints.push('NOT NULL');
  }

  // Handle foreign key
  if (metadata?.foreignKey) {
    const referencedTable = metadata.foreignKey;
    const cascade = metadata.cascade ? ' ON DELETE CASCADE' : '';
    foreignKeyConstraint = `FOREIGN KEY (${columnName}) REFERENCES ${referencedTable} (id)${cascade}`;
    sqliteType = 'INTEGER';
  }

  const orderedConstraints = orderConstraints(constraints, isOptional);
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
};

/**
 * Helper function to extract indexes from schema
 */
const extractIndexes = (schema: SchemaType, tableName: string): IndexInfo[] => {
  const indexes: IndexInfo[] = [];
  const shape = schema.shape;

  // Extract single-column indexes from field metadata
  for (const [key, value] of Object.entries(shape)) {
    const metadata = (value as z.ZodTypeAny).meta();
    if (metadata?.index) {
      const snakeCaseKey = toSnakeCase(key) || key;
      const indexName =
        (metadata.indexName as string) || `idx_${tableName}_${snakeCaseKey}`;
      indexes.push({
        columns: [snakeCaseKey],
        name: indexName,
        tableName,
        unique: (metadata.indexUnique as boolean) || false
      });
    }
  }

  // Extract composite indexes from schema metadata
  const schemaMetadata = schema.meta();
  if (schemaMetadata?.indexes && Array.isArray(schemaMetadata.indexes)) {
    for (const indexDef of schemaMetadata.indexes as Array<{
      columns: string[];
      name?: string;
      unique?: boolean;
    }>) {
      const snakeCaseColumns = indexDef.columns.map(
        (col: string) => toSnakeCase(col) || col
      );
      const indexName =
        indexDef.name || `idx_${tableName}_${snakeCaseColumns.join('_')}`;
      indexes.push({
        columns: snakeCaseColumns,
        name: indexName,
        tableName,
        unique: indexDef.unique || false
      });
    }
  }

  return indexes;
};

/**
 * Converts a Zod schema to a SQLite CREATE TABLE statement
 */
export const zodSchemaToSqliteTable = (
  schema: SchemaType,
  options?: ZodSchemaToSqliteTableOptions
): TableGenerationResult => {
  const shape = schema.shape;
  const columnDefs: string[] = [];
  const columnInfos: ColumnInfo[] = [];
  const foreignKeyConstraints: string[] = [];

  const tableName = getTableName(schema, options);
  const ifNotExists = options?.ifNotExists ?? true;

  // Process each field
  for (const [key, value] of Object.entries(shape)) {
    const snakeCaseKey = toSnakeCase(key) || key;
    const { columnDef, columnInfo, foreignKeyConstraint } =
      zodTypeToSqliteColumnWithInfo(snakeCaseKey, value as z.ZodTypeAny);
    columnDefs.push(columnDef);
    columnInfos.push(columnInfo);

    if (foreignKeyConstraint) {
      foreignKeyConstraints.push(foreignKeyConstraint);
    }
  }

  // Extract indexes
  const indexInfos = extractIndexes(schema, tableName);

  // Build SQL
  const allConstraints = [...columnDefs, ...foreignKeyConstraints];
  const sql = `CREATE TABLE${ifNotExists ? ' IF NOT EXISTS ' : ' '}${tableName} (\n  ${allConstraints.join(',\n  ')}\n);`;

  return {
    columns: columnInfos,
    indexes: indexInfos,
    sql,
    tableName
  };
};

/**
 * Converts a Zod schema to SQLite CREATE INDEX statements
 */
export const zodSchemaToSqliteIndexes = (
  schema: SchemaType,
  options?: ZodSchemaToSqliteTableOptions
): IndexGenerationResult => {
  const tableName = getTableName(schema, options);
  const indexes = extractIndexes(schema, tableName);
  const ifNotExists = (options?.ifNotExists ?? true) ? 'IF NOT EXISTS ' : '';

  const indexSql = indexes.map(indexInfo => {
    const uniqueClause = indexInfo.unique ? 'UNIQUE ' : '';
    return `CREATE ${uniqueClause}INDEX ${ifNotExists}${indexInfo.name} ON ${indexInfo.tableName} (${indexInfo.columns.join(', ')});`;
  });

  return {
    indexes,
    sql: indexSql
  };
};

/**
 * Converts a Zod schema to a complete SQLite schema (table + indexes)
 */
export const zodSchemaToSqliteSchema = (
  schema: SchemaType,
  options?: ZodSchemaToSqliteTableOptions
): string[] => {
  const tableResult = zodSchemaToSqliteTable(schema, options);
  const indexResult = zodSchemaToSqliteIndexes(schema, options);

  return [tableResult.sql, ...indexResult.sql];
};

/**
 * Helper function to get columns for statements
 */
const getStatementColumns = (
  schema: SchemaType,
  excludeAutoIncrement = false
): string[] => {
  const shape = schema.shape;
  const columns: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    if (excludeAutoIncrement) {
      const metadata = (value as z.ZodTypeAny).meta();
      if (metadata?.autoIncrement) {
        continue;
      }
    }

    const snakeCaseKey = toSnakeCase(key) || key;
    columns.push(snakeCaseKey);
  }

  return columns;
};

/**
 * Converts a Zod schema to a SQLite INSERT statement
 */
export const zodSchemaToSqliteInsert = (
  schema: SchemaType,
  options?: StatementOptions
): string => {
  const tableName = getTableName(schema, options);
  const columns = getStatementColumns(schema, true); // Exclude auto-increment columns

  const placeholders = columns.map((col, index) =>
    options?.namedParams ? `:${col}` : `?${index + 1}`
  );

  return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
};

/**
 * Converts a Zod schema to a SQLite UPDATE statement
 */
export const zodSchemaToSqliteUpdate = (
  schema: SchemaType,
  options?: StatementOptions
): string => {
  const tableName = getTableName(schema, options);
  const columns = getStatementColumns(schema, true).filter(
    col => col !== 'eid'
  );

  const placeholders = columns.map((col, index) =>
    options?.namedParams ? `:${col}` : `?${index + 1}`
  );

  const whereClause = options?.namedParams ? ':eid' : '?';

  return `UPDATE ${tableName} SET (${columns.join(', ')}) = (${placeholders.join(', ')}) WHERE eid = ${whereClause}`;
};

/**
 * Converts a Zod schema to a SQLite SELECT statement
 */
export const zodSchemaToSqliteSelect = (
  schema: SchemaType,
  options?: { tableName?: string }
): string => {
  const tableName = getTableName(schema, options);
  const columns = getStatementColumns(schema);

  return `SELECT ${columns.join(', ')} FROM ${tableName}`;
};

/**
 * Converts a Zod schema to a SQLite SELECT statement with WHERE clause
 */
export const zodSchemaToSqliteSelectWhere = (
  tableResult: TableGenerationResult,
  selectColumn: string,
  whereColumn: string | string[]
): string => {
  const tableName = tableResult.tableName;
  const whereColumns = Array.isArray(whereColumn) ? whereColumn : [whereColumn];

  const whereConditions = whereColumns.map(
    (col, index) => `${col} = ?${index + 1}`
  );
  const whereClause = whereConditions.join(' AND ');

  return `SELECT ${selectColumn} FROM ${tableName} WHERE ${whereClause}`;
};

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
};

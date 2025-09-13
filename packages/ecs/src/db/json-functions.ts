import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';

import type { Database, LoadFromJSONOptions, SaveToJSONOptions } from './index';

/**
 * Converts values to SQLite-compatible types
 */
const convertValueForSqlite = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }

  // Handle objects - try to extract primitive values first
  if (typeof value === 'object' && value !== null) {
    // Try to get the primitive value for proxy objects
    if (typeof value.valueOf === 'function') {
      const primitive = value.valueOf();
      if (
        typeof primitive === 'number' ||
        typeof primitive === 'string' ||
        typeof primitive === 'boolean'
      ) {
        return primitive;
      }
    }

    // Try toString() method for objects that might represent numbers
    if (typeof value.toString === 'function') {
      const stringVal = value.toString();
      // Check if it's a numeric string
      const numericVal = Number(stringVal);
      if (!Number.isNaN(numericVal) && Number.isFinite(numericVal)) {
        return numericVal;
      }
      // Check if it's a valid string (not [object Object])
      if (stringVal !== '[object Object]' && stringVal !== '{}') {
        return stringVal;
      }
    }

    // Check if it's a simple object with a primitive value property
    if ('value' in value) {
      const val = (value as any).value;
      if (
        typeof val === 'number' ||
        typeof val === 'string' ||
        typeof val === 'boolean'
      ) {
        return val;
      }
    }

    // For complex objects, convert to JSON
    return JSON.stringify(value);
  }

  // Fallback: convert to string
  return String(value);
};

const queryTables = (db: Database): { name: string }[] =>
  db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tbl_%' AND name NOT IN ('tbl_entity', 'tbl_component_metadata')"
  ) as { name: string }[];

/**
 * Save database content as components format
 */
export const saveAsComponents = (db: Database): unknown => {
  const result: any[] = [];

  // Get all table names that start with tbl_ except tbl_entity
  const tables = queryTables(db);

  for (const { name: tableName } of tables) {
    // Extract component name from table name (remove tbl_ prefix)
    const componentName = toCamelCase(tableName.replace(/^tbl_/, ''));

    // Get all records from this component table
    const records = db.query(`SELECT * FROM ${tableName}`);

    for (const record of records) {
      // Manually construct the object to avoid serialization issues
      const componentObj: any = { type: componentName };
      for (const [key, value] of Object.entries(record)) {
        componentObj[toCamelCase(key)] = value;
      }
      result.push(componentObj);
    }
  }

  return result;
};

/**
 * Save database content as entities format
 */
export const saveAsEntities = (db: Database): unknown => {
  const result: any[] = [];

  // Get all entities
  const entities = db.query('SELECT id FROM tbl_entity') as { id: number }[];

  // Get all component tables
  const tables = queryTables(db);

  for (const entity of entities) {
    const entityData: any = { id: entity.id };

    // For each component table, check if this entity has a record
    for (const { name: tableName } of tables) {
      const componentName = toCamelCase(tableName.replace(/^tbl_/, ''));
      const componentDataArray = db.query(
        `SELECT * FROM ${tableName} WHERE eid = ?`,
        [entity.id]
      ) as any[];

      if (componentDataArray.length > 0) {
        const componentData = componentDataArray[0];
        // Remove the eid and id columns from component data
        const { eid, id, ...cleanComponentData } = componentData as any;
        const correctedComponentData = Object.entries(
          cleanComponentData
        ).reduce(
          (acc, [key, value]) => {
            acc[toCamelCase(key)] = value;
            return acc;
          },
          {} as Record<string, unknown>
        );
        entityData[componentName] = correctedComponentData;
      }
    }

    result.push(entityData);
  }

  return result;
};

/**
 * Load data from components format
 */
export const loadFromComponents = (db: Database, json: unknown): void => {
  if (!Array.isArray(json)) {
    throw new Error('Expected array of components');
  }

  // First, validate all components and collect entity IDs
  const entityIds = new Set<number>();
  for (const component of json as any[]) {
    if (
      typeof component !== 'object' ||
      component === null ||
      !('type' in component) ||
      !('eid' in component)
    ) {
      throw new Error(
        'Invalid component format: expected object with type and eid properties'
      );
    }
    // Skip components with invalid eid values (empty objects, etc.)
    if (
      typeof component.eid === 'object' &&
      component.eid !== null &&
      Object.keys(component.eid).length === 0
    ) {
      continue;
    }
    if (typeof component.eid === 'number') {
      entityIds.add(component.eid);
    }
  }

  // Insert entities and components in a single transaction
  db.transaction(() => {
    // Insert entities first
    for (const eid of entityIds) {
      db.exec('INSERT OR IGNORE INTO tbl_entity (id) VALUES (?)', [
        Number(eid)
      ]);
    }
    for (const component of json) {
      const { type, ...componentData } = component as any;

      // Skip components with invalid eid values
      if (
        typeof componentData.eid === 'object' &&
        componentData.eid !== null &&
        Object.keys(componentData.eid).length === 0
      ) {
        continue;
      }

      const tableName = `tbl_${toSnakeCase(type)}`;
      // Get column names for this table - skip tables that don't exist
      let columns: { name: string }[];
      try {
        columns = db.query(`PRAGMA table_info(${tableName})`) as {
          name: string;
        }[];
      } catch {
        // Skip if table doesn't exist
        continue;
      }

      const validColumns = columns.map(col => col.name);

      // Filter component data to only include valid columns
      const filteredData: any = {};
      for (const col of validColumns) {
        if (col in componentData) {
          filteredData[col] = componentData[col];
        }
      }

      // Create placeholders and values for INSERT OR REPLACE
      const columnNames = Object.keys(filteredData);

      if (columnNames.length > 0) {
        const placeholders = columnNames.map(() => '?').join(', ');
        const values = columnNames.map(col =>
          convertValueForSqlite(filteredData[col])
        );

        db.exec(
          `INSERT OR REPLACE INTO ${tableName} (${columnNames.join(', ')}) VALUES (${placeholders})`,
          values
        );
      }
    }
  });
};

/**
 * Load data from entities format
 */
export const loadFromEntities = (db: Database, json: unknown): void => {
  if (!Array.isArray(json)) {
    throw new Error('Expected array of entities');
  }

  db.transaction(() => {
    for (const entity of json) {
      if (typeof entity !== 'object' || entity === null || !('id' in entity)) {
        throw new Error(
          'Invalid entity format: expected object with id property'
        );
      }

      const { id, ...components } = entity as any;

      // Insert or update entity
      db.exec('INSERT OR REPLACE INTO tbl_entity (id) VALUES (?)', [
        Number(id)
      ]);

      // Process each component
      for (const [componentName, componentData] of Object.entries(components)) {
        if (typeof componentData === 'object' && componentData !== null) {
          const tableName = `tbl_${toSnakeCase(componentName)}`;

          // Get column names for this table - skip tables that don't exist
          let columns: { name: string }[];
          try {
            columns = db.query(`PRAGMA table_info(${tableName})`) as {
              name: string;
            }[];
          } catch {
            // Skip if table doesn't exist
            continue;
          }

          const validColumns = columns.map(col => col.name);

          // Add eid to component data
          const dataWithEid = { eid: id, ...(componentData as object) };

          // Filter to only valid columns
          const filteredData: any = {};
          for (const col of validColumns) {
            if (col in dataWithEid) {
              filteredData[col] = dataWithEid[col];
            }
          }

          // Create placeholders and values for INSERT OR REPLACE
          const columnNames = Object.keys(filteredData);

          if (columnNames.length > 0) {
            const placeholders = columnNames.map(() => '?').join(', ');
            const values = columnNames.map(col =>
              convertValueForSqlite(filteredData[col])
            );

            db.exec(
              `INSERT OR REPLACE INTO ${tableName} (${columnNames.join(', ')}) VALUES (${placeholders})`,
              values
            );
          }
        }
      }
    }
  });
};

/**
 * Save database content to JSON
 */
export const saveToJSON = (
  db: Database,
  options: SaveToJSONOptions = {}
): unknown => {
  const { asComponents = false } = options;

  return asComponents ? saveAsComponents(db) : saveAsEntities(db);
};

/**
 * Load JSON data into database
 */
export const loadFromJSON = (
  db: Database,
  json: unknown,
  options: LoadFromJSONOptions = {}
): void => {
  const { asComponents = false } = options;

  if (asComponents) {
    loadFromComponents(db, json);
  } else {
    loadFromEntities(db, json);
  }
};

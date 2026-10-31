import { createLog } from 'odgn-helpers/log';

import type {
  CDef,
  CDefColumnInfo,
  CDefColumnType,
  Components,
  World
} from '@types';

const log = createLog('defaults');

/**
 * Apply default values from a Zod schema to component data
 * This function merges the provided data with default values from the schema
 */
export const applyDefaults = <T>(schema: CDef, data: Partial<T>): T => {
  const defaults = getDefaults(schema);

  // Merge defaults with provided data, with provided data taking precedence
  const merged = { ...defaults, ...data };

  // Validate the merged data against the schema
  return merged as T;
};

/**
 * Apply default values to component data using the world's component definitions
 * This function looks up the component schema and applies defaults
 */
export const applyComponentDefaults = <
  T extends Components,
  D extends Record<string, unknown>
>(
  world: World<T>,
  componentName: string,
  data: D
): D => {
  const def = world.defs.get(componentName);
  if (!def || !def.schema) {
    // If no schema found, return data as-is
    return data;
  }

  try {
    return applyDefaults(def.schema, data as Partial<D>);
  } catch (error) {
    // If validation fails, log error and return data as-is
    log.warn(`Failed to apply defaults for component ${componentName}:`, error);
    return data;
  }
};

/**
 * Get the default values for a component definition
 * @param def - The component definition
 * @returns The default values for the component
 */
export const getDefaults = (def: CDef) =>
  def.columns.reduce(
    (acc, column) => {
      if (column.default !== undefined) {
        // Convert sentinel strings to Date where applicable
        acc[column.name] = getDefaultForObject(column);
      } else if (!column.optional) {
        // Non-optional without explicit default gets a runtime default
        acc[column.name] = getDefault(column.type, true);
      }
      // Optional without default is omitted
      return acc;
    },
    {} as Record<string, string | number | boolean | Date>
  );

export const getDefaultForObject = (
  column: CDefColumnInfo
): string | number | boolean | Date => {
  if (column.default !== undefined) {
    if (
      typeof column.default === 'string' &&
      (column.default === 'current_timestamp' ||
        column.default === 'current_date' ||
        column.default === 'current_time')
    ) {
      return getDefault(column.type, true);
    }
    return column.default;
  }
  return getDefault(column.type, true);
};

export const getDefault = (
  type: CDefColumnType,
  forObject: boolean = false
) => {
  switch (type) {
    case 'array':
      return [];
    case 'enum':
      return '';
    case 'string':
    case 'email':
      return '';
    case 'int':
      return 0;
    case 'float':
      return 0.0;
    case 'boolean':
      return false;
    case 'datetime':
      return forObject ? new Date() : 'current_timestamp';
    case 'date':
      return forObject ? new Date() : 'current_date';
    case 'time':
      return forObject ? new Date() : 'current_time';
    case 'timestamp':
      return forObject ? new Date() : 'current_timestamp';
    case 'uuid':
      return Bun.randomUUIDv7();
    default:
      return '';
  }
};

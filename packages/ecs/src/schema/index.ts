import { z } from 'zod';

export const withIndex = <T extends z.ZodTypeAny>(
  schema: T,
  indexName?: string
) => schema.meta({ index: true, indexName }) as T;

export const withUniqueIndex = <T extends z.ZodTypeAny>(
  schema: T,
  indexName?: string
) => schema.meta({ index: true, indexName, indexUnique: true }) as T;

export const withCascade = <T extends z.ZodTypeAny>(schema: T) =>
  schema.meta({ cascade: true }) as T;

export const withUnique = <T extends z.ZodTypeAny>(schema: T) =>
  schema.meta({ unique: true }) as T;

export const withForeignKey = <T extends z.ZodTypeAny>(
  schema: T,
  foreignKey: string,
  cascade: boolean = false
) => schema.meta({ cascade, foreignKey }) as T;

export const pkWithAutoIncrement = () =>
  z.int().optional().meta({ autoIncrement: true, primaryKey: true });

export const componentId = () =>
  z.int().optional().meta({ autoIncrement: true, primaryKey: true });

export const withEntityId = () =>
  z.int().optional().meta({ foreignKey: 'tbl_entity' });

export const dateTimeWithDefault = () =>
  z.iso.datetime().default('CURRENT_TIMESTAMP');

export { cdefToSql } from './cdef-to-sql';
export { cdefToZod } from './cdef-to-zod';
export { cdefToTypes } from './cdef-to-types';

/**
 * Extract default values from a Zod schema
 * This function recursively traverses the schema and extracts all default values
 */
export const extractDefaults = (schema: z.ZodTypeAny): Record<string, any> => {
  const defaults: Record<string, any> = {};

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (fieldSchema instanceof z.ZodDefault) {
        // The defaultValue can be either a function or a direct value
        const defaultValue = fieldSchema._def.defaultValue;
        const value =
          typeof defaultValue === 'function' ? defaultValue() : defaultValue;

        // Handle special SQL values
        defaults[key] =
          value === 'CURRENT_TIMESTAMP' ? new Date().toISOString() : value;
      } else if (fieldSchema instanceof z.ZodObject) {
        const nestedDefaults = extractDefaults(fieldSchema);
        if (Object.keys(nestedDefaults).length > 0) {
          defaults[key] = nestedDefaults;
        }
      } else {
        const nestedDefaults = extractDefaults(fieldSchema);
        if (Object.keys(nestedDefaults).length > 0) {
          defaults[key] = nestedDefaults;
        }
      }
    }
  } else if (schema instanceof z.ZodDefault) {
    // This shouldn't happen at the top level, but handle it just in case
    return {};
  }

  return defaults;
};

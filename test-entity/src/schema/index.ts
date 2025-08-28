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

export const dateTime = () => z.iso.datetime().default('CURRENT_TIMESTAMP');

import type { CDef } from '../types';
import { getDefaults } from './defaults';
import type { InferComponentType } from './types';

export const createComponent = <T extends CDef>(
  def: T,
  data: Partial<InferComponentType<T>> = {}
): InferComponentType<T> => {
  const defaults = getDefaults(def);
  const result = { ...defaults, ...data };

  // Validate that all required fields are provided
  for (const column of def.columns) {
    if (!column.optional && column.default === undefined) {
      const value = result[column.name];
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value === '') ||
        (typeof value === 'number' && value === 0)
      ) {
        throw new Error(
          `Required field '${column.name}' is missing or has default value`
        );
      }
    }
  }

  return result as InferComponentType<T>;
};

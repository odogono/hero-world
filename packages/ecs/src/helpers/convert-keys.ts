import { toSnakeCase } from 'odgn-helpers';

// Helper function to convert object keys from camelCase to snake_case
export const convertKeysToSnakeCase = (
  obj: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = toSnakeCase(key) || key;
    result[snakeKey] = value;
  }
  return result;
};

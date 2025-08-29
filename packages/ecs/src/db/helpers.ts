import { toSnakeCase } from 'odgn-helpers';

export const convertKeysToNamedParams = (
  obj: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const namedParam = `:${toSnakeCase(key) || key}`;
    result[namedParam] = value;
  }
  return result;
};

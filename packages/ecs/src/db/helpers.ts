import { toSnakeCase } from 'odgn-helpers/string';

export const convertKeysToNamedParams = (
  obj: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeCaseKey = toSnakeCase(key) || key;
    const namedParam = `:${snakeCaseKey}`;
    result[namedParam] = value;
  }
  return result;
};

export const isArray = (args: unknown): args is unknown[] =>
  Array.isArray(args);
export const isObject = (args: unknown): args is Record<string, unknown> =>
  typeof args === 'object' && args !== null;

export const parseArgs = (
  args: unknown[] | Record<string, unknown> | unknown,
  ...rest: unknown[]
) => {
  if (!args && rest.length === 0) {
    return null;
  }

  if (Array.isArray(args)) {
    return args;
  } else if (isObject(args) && rest.length === 0) {
    return args;
  } else if (rest.length > 0) {
    return [args, ...rest];
  } else {
    return [args];
  }
};

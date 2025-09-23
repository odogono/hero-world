import { trycatch, type OperationResult } from './try-catch';

export const safeParseJSON = (value: string, defaultValue: unknown = null) => {
  const [result, error] = trycatch<string>(() =>
    JSON.parse(value)
  ) as unknown as OperationResult<string, Error>;

  if (error) {
    return defaultValue;
  }

  return result;
};

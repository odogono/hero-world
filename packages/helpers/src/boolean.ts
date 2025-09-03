export const isBoolean = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};

export const toBoolean = (value: unknown): boolean | unknown => {
  if (isBoolean(value)) {
    return value;
  }
  switch (value) {
    case 'True':
    case 'true':
    case '1':
      return true;
    case 'False':
    case 'false':
    case '0':
      return false;
    default:
      return value;
  }
};

export const safeParseBoolean = (
  value: unknown,
  defaultValue: boolean = false
): boolean => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (isBoolean(value)) {
    return value;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }

  return defaultValue;
};

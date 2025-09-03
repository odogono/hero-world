export const roundNumberToDecimalPlaces = (
  number: number,
  places: number = 3
): number => {
  const h = Math.pow(10, places);
  return Math.round(number * h) / h;
};

export const safeParseInt = (
  value: string | undefined,
  defaultTo: number = -1
): number => {
  if (!value) {
    return defaultTo;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultTo : parsed;
};

export const safeParseFloat = (
  value: string,
  defaultTo: number = 0
): number => {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? defaultTo : parsed;
};

export const integerToString = (value: number = 0) =>
  Math.round(value).toString();

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);

/**
 *
 * @param {*} value
 * @param {*} defaultValue
 */
export const toInteger = (value: any, defaultValue: number = 0) => {
  let result = parseInt(value, 10);
  if (Number.isNaN(result)) {
    result = defaultValue;
  }
  return result < 0 ? Math.ceil(result) : Math.floor(result);
};

/**
 * @param value
 * @param defaultValue
 */
export const toNumber = (value: any, defaultValue: number = 0) => {
  let result = Number(value);
  if (Number.isNaN(result)) {
    result = defaultValue;
  }
  return result;
};

export const ONE_SECOND = 1000;
export const ONE_MINUTE = ONE_SECOND * 60;
export const FIVE_MINUTES = ONE_MINUTE * 5;
export const TEN_MINUTES = ONE_MINUTE * 10;
export const THIRTY_MINUTES = ONE_MINUTE * 30;
export const ONE_HOUR = ONE_MINUTE * 60;
export const ONE_DAY = ONE_HOUR * 24;
export const ONE_WEEK = ONE_DAY * 7;
export const ONE_MONTH = ONE_DAY * 30;
export const ONE_YEAR = ONE_DAY * 365;

export const INFINITY = Infinity;

/**
 * Waits for a given number of milliseconds
 * @param time Number of milliseconds to wait
 * @returns Promise that resolves after the given time
 */
export const wait = async (time: number = 1000): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });

export type TimeoutId = ReturnType<typeof setTimeout>;

/**
 * Runs a function after a given number of milliseconds
 * @param time Number of milliseconds to wait
 * @param fn Function to run
 */
export const runAfter = (time: number, fn: () => void): TimeoutId =>
  setTimeout(() => fn(), time);

export const clearRunAfter = (timeoutId: TimeoutId | null | undefined) => {
  if (!timeoutId) {
    return undefined;
  }
  clearTimeout(timeoutId);
  return undefined;
};

const TimeStampOptions: Intl.DateTimeFormatOptions = {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

/**
 * Returns a timestamp in the format of HH:MM:SS.SSS
 * @returns Timestamp in the format of HH:MM:SS.SSS
 *
 * @example
 * getTimestamp() // "12:34:56.789"
 */
export const getTimestamp = (): string => {
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-GB', TimeStampOptions);
  const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
  return `${timeString}.${milliseconds}`;
};

/**
 * Returns the current Unix time in seconds
 * @returns Current Unix timestamp in seconds
 *
 * @example
 * getUnixTime() // 1703123456
 */
export const getUnixTime = (): number => Date.now() / 1000;

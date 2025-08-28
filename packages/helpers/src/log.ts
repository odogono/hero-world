/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */

export type LogTypes =
  | 'assert'
  | 'log'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'dir'
  | 'group'
  | 'groupCollapsed'
  | 'groupEnd'
  | 'table';

const logTypes: LogTypes[] = [
  'assert',
  'log',
  'debug',
  'info',
  'warn',
  'error',
  'dir',
  'table',
  'group',
  'groupCollapsed',
  'groupEnd'
];

const ignorePrefixTypes = ['group', 'groupCollapsed', 'groupEnd', 'table'];

export type LoggerBase = {
  _isDisabled: LogTypes[];
  _prefix: string | null;
};

export type LogFn = (...args: any[]) => void;

export type Logger = Record<LogTypes, LogFn> & LoggerBase;

export const createLog = (
  prefix: string | null = null,
  disabled: LogTypes[] = []
) => {
  const prefixTxt = prefix && prefix.length > 0 ? `[${prefix}]` : '';

  const result: Logger = {} as Logger;

  result._prefix = prefix;
  result._isDisabled = disabled;

  let logTime = Date.now();

  for (const logType of logTypes) {
    result[logType] = (...args: any[]) => {
      const now = Date.now();
      if (now - logTime > 10_000) {
        logTime = now;
      }
      const delta = now - logTime;

      const logPrefix = `[${delta}]${prefixTxt}`;

      if (!disabled.includes(logType)) {
        if (logType === 'assert') {
          const assertion = args[0];
          const rest = args.slice(1);
          console.assert(assertion, [logPrefix, ...rest].join(' '));
        } else if (ignorePrefixTypes.includes(logType)) {
          console[logType](...args);
        } else {
          console[logType](logPrefix, ...args);
        }
      }
    };
  }

  if (disabled.length > 0) {
    // console.warn(`[${prefix}] some logs are disabled: ${disabled.join(', ')}`);
  }

  return result;
};

import { expect, test } from 'bun:test';

import { trycatch, type OperationResult } from '../try-catch';

test('trycatch with synchronous operation that succeeds', () => {
  const result = trycatch(() => 'success');

  expect(result).toEqual(['success', null]);
  expect(result[0]).toBe('success');
  expect(result[1]).toBeNull();
});

test('trycatch with synchronous operation that throws', () => {
  const error = new Error('test error');
  const result = trycatch(() => {
    throw error;
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('test error');
});

test('trycatch with synchronous operation that throws non-Error', () => {
  const result = trycatch(() => {
    throw 'string error';
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('string error');
});

test('trycatch with Promise that resolves', async () => {
  const promise = Promise.resolve('async success');
  const result = await trycatch(promise);

  expect(result).toEqual(['async success', null]);
  expect(result[0]).toBe('async success');
  expect(result[1]).toBeNull();
});

test('trycatch with Promise that rejects', async () => {
  const error = new Error('async error');
  const promise = Promise.reject(error);
  const result = await trycatch(promise);

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('async error');
});

test('trycatch with function that returns Promise that resolves', async () => {
  const result = await trycatch(async () => 'function async success');

  expect(result).toEqual(['function async success', null]);
  expect(result[0]).toBe('function async success');
  expect(result[1]).toBeNull();
});

test('trycatch with function that returns Promise that rejects', async () => {
  const error = new Error('function async error');
  const result = await trycatch(async () => {
    throw error;
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('function async error');
});

test('trycatch with function that returns Promise that rejects with non-Error', async () => {
  const result = await trycatch(async () => {
    throw 'function async string error';
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('function async string error');
});

test('trycatch with complex data types', () => {
  const complexData = { id: 1, name: 'test', nested: { value: true } };
  const result = trycatch(() => complexData);

  expect(result).toEqual([complexData, null]);
  expect(result[0]).toEqual(complexData);
  expect(result[1]).toBeNull();
});

test('trycatch with null and undefined values', () => {
  const nullResult = trycatch(() => null);
  const undefinedResult = trycatch(() => undefined);

  expect(nullResult).toEqual([null, null]);
  expect(undefinedResult).toEqual([undefined, null]);
});

test('trycatch with number operations', () => {
  const successResult = trycatch(() => 42);
  const failureResult = trycatch(() => {
    throw new Error('number error');
  });

  expect(successResult).toEqual([42, null]);
  expect(failureResult[0]).toBeNull();
  expect((failureResult[1] as Error).message).toBe('number error');
});

test('trycatch with boolean operations', () => {
  const trueResult = trycatch(() => true);
  const falseResult = trycatch(() => false);

  expect(trueResult).toEqual([true, null]);
  expect(falseResult).toEqual([false, null]);
});

test('trycatch with array operations', () => {
  const array = [1, 2, 3, 4, 5];
  const result = trycatch(() => array);

  expect(result).toEqual([array, null]);
  expect(result[0]).toEqual(array);
  expect(result[1]).toBeNull();
});

test('trycatch preserves error stack trace', () => {
  const result = trycatch(() => {
    throw new Error('stack trace test');
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).stack).toBeDefined();
  expect((result[1] as Error).stack).toContain('stack trace test');
});

test('trycatch with custom error types', () => {
  class CustomError extends Error {
    constructor(
      message: string,
      public code: number
    ) {
      super(message);
      this.name = 'CustomError';
    }
  }

  const result = trycatch(() => {
    throw new CustomError('custom error', 500);
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as CustomError).code).toBe(500);
});

test('trycatch with async function that returns complex data', async () => {
  const complexData = {
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
  };
  const result = await trycatch(async () => complexData);

  expect(result).toEqual([complexData, null]);
  expect(result[0]).toEqual(complexData);
  expect(result[1]).toBeNull();
});

test('trycatch with function that returns never (throws)', () => {
  const result = trycatch(() => {
    throw new Error('never function');
  }) as OperationResult<never, Error>;

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('never function');
});

test('trycatch type safety with different error types', () => {
  const result = trycatch<string, TypeError>(() => {
    throw new TypeError('type error');
  });

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(TypeError);
  expect((result[1] as TypeError).message).toBe('type error');
});

test('trycatch with Promise that rejects with non-Error', async () => {
  const result = await trycatch(Promise.reject('promise string error'));

  expect(result[0]).toBeNull();
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).toBe('promise string error');
});

test('trycatch with nested trycatch operations', () => {
  const innerResult = trycatch(() => 'inner success');
  const outerResult = trycatch(() => innerResult);

  expect(outerResult).toEqual([innerResult, null]);
  expect(outerResult[0]).toEqual(['inner success', null]);
  expect(outerResult[1]).toBeNull();
});

test('trycatch with async nested operations', async () => {
  const innerPromise = trycatch(async () => 'inner async success');
  const outerResult = await trycatch(innerPromise);

  expect(outerResult).toEqual([['inner async success', null], null]);
  expect(outerResult[0]).toEqual(['inner async success', null]);
  expect(outerResult[1]).toBeNull();
});

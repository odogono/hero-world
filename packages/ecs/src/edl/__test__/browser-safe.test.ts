// The EDL reader's own path and hash code agrees with Node's, so a World
// read in a Web Worker hashes and resolves its includes as one read here
// does (ADR 0023).
import { createHash } from 'node:crypto';
import { dirname as nodeDirname, resolve as nodeResolve } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { dirname, isAbsolute, resolve } from '../paths';
import { sha256 } from '../sha256';

describe('sha256', () => {
  test.each([
    '',
    'abc',
    'atom thing {}\n',
    'é ✓ 😀',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(1000)
  ])('matches node:crypto for %#', text => {
    expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
  });
});

describe('paths', () => {
  test.each([['/a/b/c.edl'], ['/a/b/'], ['/a'], ['/'], ['a/b'], ['a']])(
    'dirname matches node:path for %s',
    path => {
      expect(dirname(path)).toBe(nodeDirname(path));
    }
  );

  test.each([
    [['/root', 'edl/base.edl']],
    [['/a/b', '../c/./d.edl']],
    [['/a/b', '/abs/x.edl']],
    [['/a', 'b', '..', 'c']],
    [['/']]
  ])('resolve matches node:path for %j', parts => {
    expect(resolve(...parts)).toBe(nodeResolve(...parts));
  });

  test('isAbsolute', () => {
    expect(isAbsolute('/x')).toBe(true);
    expect(isAbsolute('x')).toBe(false);
  });
});

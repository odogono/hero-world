import { expect, test } from 'bun:test';

import {
  isExemptLocalMessage,
  parseCommitSubject,
  requiresChangelog,
  splitMessage,
  type Subject
} from './message';

const parse = (text: string): Subject => {
  const result = parseCommitSubject(text);
  if ('errors' in result) {
    throw new Error(result.errors.join('\n'));
  }
  return result.subject;
};

test('reads a subject with and without a scope and "!"', () => {
  expect(parse('feat(ecs): add the Store capability (#226)')).toEqual({
    breaking: false,
    description: 'add the Store capability (#226)',
    scope: 'ecs',
    type: 'feat'
  });
  expect(parse('docs: record ADR 0051')).toMatchObject({
    breaking: false,
    scope: undefined,
    type: 'docs'
  });
  expect(parse('refactor(mua)!: rename Grants')).toMatchObject({
    breaking: true,
    scope: 'mua'
  });
  expect(parse('fix: `wait for` keeps its deadline')).toMatchObject({
    type: 'fix'
  });
});

test('rejects malformed subjects, unknown types and scopes, and style', () => {
  expect(parseCommitSubject('Add the Store capability')).toEqual({
    errors: [
      '"Add the Store capability" isn\'t "type(scope): description"; the scope and a "!" before the colon are optional'
    ]
  });
  expect(parseCommitSubject('feat:Add x')).toHaveProperty('errors');
  expect(parseCommitSubject('feature: add x')).toEqual({
    errors: [
      'unknown type "feature"; use one of feat, fix, perf, refactor, docs, test, build, ci, chore, revert'
    ]
  });
  expect(parseCommitSubject('feat(core): add x')).toEqual({
    errors: [
      'unknown scope "core"; use one of ecs, ecs-talk, helpers, mua, tank-world, repo'
    ]
  });
  expect(parseCommitSubject('feat(): Add x')).toHaveProperty('errors');
  expect(parseCommitSubject('feat: Add x.')).toEqual({
    errors: [
      'the description "Add x." must start with a lowercase letter',
      "the description doesn't end with a full stop"
    ]
  });
});

test('requires a changelog entry for feat, fix, perf and breaking changes', () => {
  expect(requiresChangelog(parse('feat: add x'))).toBe(true);
  expect(requiresChangelog(parse('fix(ecs): fix x'))).toBe(true);
  expect(requiresChangelog(parse('perf: speed up x'))).toBe(true);
  expect(requiresChangelog(parse('refactor: move x'))).toBe(false);
  expect(requiresChangelog(parse('ci(repo): check titles'))).toBe(false);
  expect(requiresChangelog(parse('refactor!: rename x'))).toBe(true);
  expect(
    requiresChangelog(
      parse('refactor: rename x'),
      'Details.\n\nBREAKING CHANGE: x is now y'
    )
  ).toBe(true);
  expect(
    requiresChangelog(
      parse('refactor: rename x'),
      'Mentions BREAKING CHANGE: inline'
    )
  ).toBe(false);
});

test('lets through commits git writes or a squash removes', () => {
  expect(isExemptLocalMessage('fixup! feat: add x')).toBe(true);
  expect(isExemptLocalMessage('squash! feat: add x')).toBe(true);
  expect(isExemptLocalMessage("Merge branch 'main' into x")).toBe(true);
  expect(isExemptLocalMessage('Revert "feat: add x"')).toBe(true);
  expect(isExemptLocalMessage('Add x')).toBe(false);
  expect(isExemptLocalMessage('revert: undo x')).toBe(false);
});

test('splits a message file, dropping git comment lines', () => {
  expect(
    splitMessage(
      '# Please enter the commit message\n\nfeat: add x  \n\nWhy.\n# On branch x\n'
    )
  ).toEqual({ body: 'Why.', subject: 'feat: add x' });
  expect(splitMessage('# only comments\n')).toEqual({ body: '', subject: '' });
});

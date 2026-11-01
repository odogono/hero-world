import { expect, test } from 'bun:test';

import { fragmentMatches, parseFragment, type Fragment } from './fragment';
import { parseCommitSubject, type Subject } from './message';

const fragment = (text: string): Fragment => {
  const result = parseFragment(text);
  if ('errors' in result) {
    throw new Error(result.errors.join('\n'));
  }
  return result.fragment;
};

const subject = (text: string): Subject => {
  const result = parseCommitSubject(text);
  if ('errors' in result) {
    throw new Error(result.errors.join('\n'));
  }
  return result.subject;
};

test('reads a fragment', () => {
  expect(
    fragment('---\ntype: feat\nscope: ecs\n---\nAdd the Store.\n\nMore.\n')
  ).toEqual({
    breaking: false,
    entry: 'Add the Store.\n\nMore.',
    scope: 'ecs',
    type: 'feat'
  });
  expect(fragment('---\ntype: fix\nbreaking: true\n---\nFix x.')).toEqual({
    breaking: true,
    entry: 'Fix x.',
    scope: undefined,
    type: 'fix'
  });
});

test('rejects fragments without frontmatter, a type, a valid scope or text', () => {
  expect(parseFragment('Add x.')).toEqual({
    errors: ['it must start with a "---" frontmatter block']
  });
  expect(parseFragment('---\nscope: ecs\n---\nAdd x.')).toEqual({
    errors: ['"type" is missing']
  });
  expect(parseFragment('---\ntype: docs\n---\nAdd x.')).toHaveProperty(
    'errors'
  );
  expect(parseFragment('---\ntype: feat\nscope: core\n---\nAdd x.')).toEqual({
    errors: [
      'unknown scope "core"; use one of ecs, ecs-talk, helpers, mua, repo'
    ]
  });
  expect(parseFragment('---\ntype: feat\nsummary: x\n---\nAdd x.')).toEqual({
    errors: ['unknown key "summary"']
  });
  expect(parseFragment('---\ntype: feat\n---\n\n')).toEqual({
    errors: ['the entry text after the frontmatter is empty']
  });
});

test('matches a fragment to the PR title by type, scope and breaking', () => {
  const feat = fragment('---\ntype: feat\nscope: ecs\n---\nAdd x.');
  expect(fragmentMatches(feat, subject('feat(ecs): add x'), false)).toBe(true);
  expect(fragmentMatches(feat, subject('feat(mua): add x'), false)).toBe(false);
  expect(fragmentMatches(feat, subject('feat: add x'), false)).toBe(false);
  expect(fragmentMatches(feat, subject('fix(ecs): fix x'), false)).toBe(false);
  expect(fragmentMatches(feat, subject('feat(ecs)!: add x'), true)).toBe(false);

  const breaking = fragment(
    '---\ntype: feat\nscope: mua\nbreaking: true\n---\nRename x.'
  );
  expect(
    fragmentMatches(breaking, subject('refactor(mua)!: rename x'), true)
  ).toBe(true);
  expect(
    fragmentMatches(breaking, subject('refactor(ecs)!: rename x'), true)
  ).toBe(false);
});

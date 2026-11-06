import { expect, test } from 'bun:test';

import { mixRef, pinErrors, tsVersion } from './pins';

const HEAD = '5bae9a9938925d7609476726b4cc8b5acd33277e';

test('reads the ref a mix.exs pins', () => {
  const source = `{:north_talk,\n github: "odogono/odgn-talk",\n sparse: "impl/elixir",\n ref: "${HEAD}"},`;
  expect(mixRef(source)).toBe(HEAD);
  expect(mixRef('{:jason, "~> 1.4"}')).toBeUndefined();
});

test('reads only an exact @northtalk/ts version', () => {
  expect(tsVersion('{"dependencies":{"@northtalk/ts":"0.7.0"}}')).toBe('0.7.0');
  expect(
    tsVersion('{"dependencies":{"@northtalk/ts":"^0.7.0"}}')
  ).toBeUndefined();
});

test('accepts pins on one commit, and names a mix.exs that differs', () => {
  const mix = new Map([
    ['a/mix.exs', HEAD],
    ['b/mix.exs', 'abc123']
  ]);
  expect(pinErrors(new Map([['a/mix.exs', HEAD]]), '0.7.0', HEAD)).toEqual([]);
  expect(pinErrors(mix, '0.7.0', HEAD)).toEqual([
    `b/mix.exs pins odgn-talk abc123, but @northtalk/ts 0.7.0 is ${HEAD}`
  ]);
  expect(pinErrors(mix, undefined, undefined)).toHaveLength(1);
});

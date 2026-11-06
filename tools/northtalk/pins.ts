#!/usr/bin/env bun
// Checks that ecs-talk and every Mix package use one odgn-talk commit (ADR
// 0021): each mix.exs pins `north_talk` to a ref, and ecs-talk depends on a
// `@northtalk/ts` release, whose registry `gitHead` is the commit it was
// published from.
//
//   bun tools/northtalk/pins.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const PACKAGE = 'packages/ecs-talk/package.json';

/** The `north_talk` ref a mix.exs pins, or undefined if it has none */
export const mixRef = (source: string): string | undefined =>
  /\{:north_talk,[^}]*?ref:\s*"([0-9a-f]+)"/s.exec(source)?.[1];

/** The exact `@northtalk/ts` version a package.json depends on */
export const tsVersion = (json: string): string | undefined => {
  const v = (JSON.parse(json) as { dependencies?: Record<string, string> })
    .dependencies?.['@northtalk/ts'];
  return v && /^\d+\.\d+\.\d+$/.test(v) ? v : undefined;
};

/** The problems with these pins, if any */
export const pinErrors = (
  mix: ReadonlyMap<string, string | undefined>,
  version: string | undefined,
  gitHead: string | undefined
): string[] => {
  const errors: string[] = [];
  if (!version) {
    errors.push(`${PACKAGE} must depend on an exact @northtalk/ts version`);
  } else if (!gitHead) {
    errors.push(`@northtalk/ts ${version} has no gitHead in the registry`);
  }
  for (const [file, ref] of mix) {
    if (ref && gitHead && ref !== gitHead) {
      errors.push(
        `${file} pins odgn-talk ${ref}, but @northtalk/ts ${version} is ${gitHead}`
      );
    }
  }
  return errors;
};

const fetchGitHead = async (version: string) => {
  const response = await fetch(
    `https://registry.npmjs.org/@northtalk/ts/${version}`
  );
  if (!response.ok) {
    throw new Error(`registry: @northtalk/ts ${version}: ${response.status}`);
  }
  return ((await response.json()) as { gitHead?: string }).gitHead;
};

if (import.meta.main) {
  const mix = new Map<string, string | undefined>();
  for (const dir of readdirSync(join(ROOT, 'packages'))) {
    try {
      const file = `packages/${dir}/mix.exs`;
      const ref = mixRef(readFileSync(join(ROOT, file), 'utf8'));
      if (ref) {
        mix.set(file, ref);
      }
    } catch {
      // not a Mix package
    }
  }
  const version = tsVersion(readFileSync(join(ROOT, PACKAGE), 'utf8'));
  const gitHead = version ? await fetchGitHead(version) : undefined;
  const errors = pinErrors(mix, version, gitHead);
  for (const error of errors) {
    console.error(`northtalk pins: ${error}`);
  }
  if (errors.length === 0) {
    console.log(
      `northtalk pins: @northtalk/ts ${version} and ${mix.size} mix.exs files at ${gitHead}`
    );
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

#!/usr/bin/env bun
// Typechecks each project and compares its errors, per file, with
// tools/typecheck/baseline.json, as docs/agents/checks.md describes.
//
//   bun tools/typecheck/ratchet.ts            fail when a file gains errors
//   bun tools/typecheck/ratchet.ts --update   rewrite the baseline
//
// The repo has type errors it predates this check by. The ratchet holds the
// count per file so new code adds none; fixing a file lowers its count, and
// `--update` records the lower count so it can't creep back up.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const BASELINE = join(import.meta.dir, 'baseline.json');

// tank-world is left out until it moves to the current odgn-ecs API.
const PROJECTS = [
  'packages/ecs',
  'packages/ecs-talk',
  'packages/helpers',
  'packages/mua',
  'tools'
];

type Counts = Record<string, Record<string, number>>;

const ERROR = /^(?<file>[^\s(][^(]*)\(\d+,\d+\): error TS\d+/;

const typecheck = (project: string): Record<string, number> => {
  const dir = join(ROOT, project);
  const { stdout } = spawnSync(
    'bunx',
    ['tsc', '--noEmit', '-p', 'tsconfig.json'],
    { cwd: dir, encoding: 'utf8' }
  );
  const counts: Record<string, number> = {};
  for (const line of stdout.split('\n')) {
    const file = ERROR.exec(line)?.groups?.file;
    if (file) {
      const path = relative(ROOT, join(dir, file));
      counts[path] = (counts[path] ?? 0) + 1;
    }
  }
  return counts;
};

const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

const current: Counts = {};
for (const project of PROJECTS) {
  current[project] = sorted(typecheck(project));
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  const total = Object.values(current)
    .flatMap(Object.values)
    .reduce((a, b) => a + b, 0);
  console.log(`typecheck: baseline written, ${total} errors`);
  process.exit(0);
}

const baseline: Counts = JSON.parse(readFileSync(BASELINE, 'utf8'));
const worse: string[] = [];
const better: string[] = [];
for (const project of PROJECTS) {
  const was = baseline[project] ?? {};
  const now = current[project] ?? {};
  for (const file of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const before = was[file] ?? 0;
    const after = now[file] ?? 0;
    if (after > before) {
      worse.push(`${project}: ${file} has ${after} errors, was ${before}`);
    } else if (after < before) {
      better.push(`${project}: ${file} has ${after} errors, was ${before}`);
    }
  }
}

for (const line of better) {
  console.log(`typecheck: ${line}`);
}
if (better.length > 0) {
  console.log(
    'typecheck: run `bun run typecheck:update` and commit the baseline to lock in the fixes'
  );
}
if (worse.length > 0) {
  for (const line of worse) {
    console.error(`typecheck: ${line}`);
  }
  console.error(
    'typecheck: fix the new errors; `cd <project> && bunx tsc --noEmit -p tsconfig.json` lists them. See docs/agents/checks.md.'
  );
  process.exit(1);
}

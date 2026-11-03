#!/usr/bin/env bun
// Typechecks each project with its own tsconfig.json and fails on any error.
//
//   bun tools/typecheck/check.ts
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

const PROJECTS = [
  'packages/ecs',
  'packages/helpers',
  'packages/mua_client',
  'tools'
];

let failed = false;
for (const project of PROJECTS) {
  const { status, stdout } = spawnSync(
    'bunx',
    ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
    { cwd: join(ROOT, project), encoding: 'utf8' }
  );
  if (status !== 0) {
    failed = true;
    console.error(`typecheck: ${project}`);
    console.error(stdout.trimEnd());
  }
}
process.exit(failed ? 1 : 0);

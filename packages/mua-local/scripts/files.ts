#!/usr/bin/env bun
// The main World's files for a Local World (ADR 0023): mua_world's EDL and
// Scripts at /world, and packages/mua-scripts at /mua-scripts, keyed by those
// virtual paths. The Worker imports `worldFiles` as a Bun macro, so they are
// read when it is bundled. Run on its own, it lists them.
//
//   bun scripts/files.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const PACKAGES = resolve(import.meta.dir, '../..');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : /\.(edl|talk)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );

export const worldFiles = (): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const [root, virtual] of [
    [join(PACKAGES, 'mua_world/priv/edl'), '/world'],
    [join(PACKAGES, 'mua-scripts'), '/mua-scripts']
  ] as const) {
    for (const file of walk(root).sort()) {
      files[`${virtual}/${relative(root, file)}`] = readFileSync(file, 'utf8');
    }
  }
  return files;
};

if (import.meta.main) {
  for (const [path, source] of Object.entries(worldFiles())) {
    console.log(`${path} (${source.length} bytes)`);
  }
}

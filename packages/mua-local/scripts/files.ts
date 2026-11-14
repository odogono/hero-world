#!/usr/bin/env bun
// The main World's files for a Local World (ADR 0023): mua_world's EDL and
// Scripts at /world, and packages/mua-scripts at /mua-scripts, keyed by those
// virtual paths. The Worker imports `worldFiles` as a Bun macro, so they are
// read when it is bundled. Run on its own, it lists them.
//
//   bun scripts/files.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { pictureUrl } from 'mua-world';

const PACKAGES = resolve(import.meta.dir, '../..');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : /\.(edl|talk)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );

/**
 * Each of the main World's Pictures, by its `src` (`pictures/harbour_steps.png`),
 * and the URL the server serves it at, with a hash of the file (ADR 0027).
 * The Worker imports it as a macro too, so a Local World checks its
 * Pictures as the server does, without the images in its bundle.
 */
export const worldPictures = (): Record<string, string> => {
  const root = join(PACKAGES, 'mua_world/priv/edl');
  const dir = join(root, 'pictures');
  const pictures: Record<string, string> = {};
  const walkAll = (at: string): string[] =>
    readdirSync(at, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory()
        ? walkAll(join(at, entry.name))
        : [join(at, entry.name)]
    );
  for (const file of existsSync(dir) ? walkAll(dir).sort() : []) {
    const src = relative(root, file);
    const hash = new Bun.CryptoHasher('sha256')
      .update(readFileSync(file))
      .digest('hex');
    pictures[src] = pictureUrl(src, hash);
  }
  return pictures;
};

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
  for (const [src, url] of Object.entries(worldPictures())) {
    console.log(`${src} at ${url}`);
  }
}

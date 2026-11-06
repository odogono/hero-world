#!/usr/bin/env bun
// Builds the arcade page into `outdir`: index.html, main.js (Three.js),
// worker.js (the World), and the sqlite3.wasm the Worker loads from beside
// it. As mua-local's bundle does, it leaves out Bun's database, which a
// Worker never asks for.
//
//   bun scripts/bundle.ts <outdir> [--dev]
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

export const bundle = async (outdir: string, dev = false) => {
  mkdirSync(outdir, { recursive: true });
  const built = await Bun.build({
    entrypoints: [
      join(ROOT, 'src/browser/main.ts'),
      join(ROOT, 'src/browser/worker.ts')
    ],
    external: ['bun:sqlite', 'node:fs'],
    format: 'esm',
    minify: !dev,
    naming: { entry: '[name].js' },
    outdir,
    sourcemap: dev ? 'linked' : 'none',
    target: 'browser'
  });
  if (!built.success) {
    throw new AggregateError(built.logs, 'the arcade page did not build');
  }
  const dist = dirname(Bun.resolveSync('@sqlite.org/sqlite-wasm', ROOT));
  // sqlite-wasm fetches its OPFS proxy as it starts, even for a World in
  // memory
  for (const file of ['sqlite3.wasm', 'sqlite3-opfs-async-proxy.js']) {
    copyFileSync(join(dist, file), join(outdir, file));
  }
  copyFileSync(
    join(ROOT, 'src/browser/index.html'),
    join(outdir, 'index.html')
  );
};

if (import.meta.main) {
  const [outdir] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!outdir) {
    console.error('usage: bun scripts/bundle.ts <outdir> [--dev]');
    process.exit(1);
  }
  await bundle(resolve(outdir), process.argv.includes('--dev'));
  console.log(`built the arcade page into ${outdir}`);
}

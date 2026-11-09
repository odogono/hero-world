#!/usr/bin/env bun
// Builds the browser's Workers into `outdir`: worker.js, a Local World
// (ADR 0023) with the World's files inlined by a macro (scripts/files.ts);
// mirror.js, which holds a mirror of a server's World (#164); and the
// sqlite-wasm files both load from beside them. The page that starts it must be cross-origin
// isolated (COOP and COEP), since sqlite-wasm's OPFS needs SharedArrayBuffer.
//
//   bun scripts/bundle.ts <outdir> [--dev]
import { copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

// sqlite-wasm loads these by URL, relative to the Worker
const SQLITE_FILES = ['sqlite3.wasm', 'sqlite3-opfs-async-proxy.js'];

export const bundleWorker = async (outdir: string, dev = false) => {
  const built = await Bun.build({
    entrypoints: [join(ROOT, 'src/worker.ts')],
    // odgn-ecs loads its Bun database only when asked for one, which a
    // Worker never is
    external: ['bun:sqlite', 'node:fs'],
    format: 'esm',
    minify: !dev,
    naming: { entry: 'worker.js' },
    outdir,
    sourcemap: dev ? 'linked' : 'none',
    target: 'browser'
  });
  if (!built.success) {
    throw new AggregateError(
      built.logs,
      'the Local World Worker did not build'
    );
  }
  // the mirror of a server's World (#164), which needs no World files
  const mirror = await Bun.build({
    entrypoints: [join(ROOT, 'src/mirror-worker.ts')],
    external: ['bun:sqlite', 'node:fs'],
    format: 'esm',
    minify: !dev,
    naming: { entry: 'mirror.js' },
    outdir,
    sourcemap: dev ? 'linked' : 'none',
    target: 'browser'
  });
  if (!mirror.success) {
    throw new AggregateError(mirror.logs, 'the mirror Worker did not build');
  }
  const dist = dirname(Bun.resolveSync('@sqlite.org/sqlite-wasm', ROOT));
  for (const file of SQLITE_FILES) {
    copyFileSync(join(dist, file), join(outdir, file));
  }
};

if (import.meta.main) {
  const [outdir] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!outdir) {
    console.error('usage: bun scripts/bundle.ts <outdir> [--dev]');
    process.exit(1);
  }
  await bundleWorker(resolve(outdir), process.argv.includes('--dev'));
  console.log(`built the Local World Worker into ${outdir}`);
}

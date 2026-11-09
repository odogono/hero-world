#!/usr/bin/env bun
// Builds the browser's Workers into `outdir`: worker.js, a Local World
// (ADR 0023) with the World's files inlined by a macro (scripts/files.ts);
// mirror.js, which holds a mirror of a server's World (#164); preview.js,
// a Preview World for authors (#243); and the sqlite-wasm files they load
// from beside them. The page that starts it must be cross-origin
// isolated (COOP and COEP), since sqlite-wasm's OPFS needs SharedArrayBuffer.
//
//   bun scripts/bundle.ts <outdir> [--dev]
import { copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

// sqlite-wasm loads these by URL, relative to the Worker
const SQLITE_FILES = ['sqlite3.wasm', 'sqlite3-opfs-async-proxy.js'];

// Each Worker's source and the file it is built to
const WORKERS = [
  // a Local World (ADR 0023)
  { entry: 'worker.ts', name: 'worker.js' },
  // the mirror of a server's World (#164)
  { entry: 'mirror-worker.ts', name: 'mirror.js' },
  // a Preview World for authors (#243)
  { entry: 'preview-worker.ts', name: 'preview.js' }
];

export const bundleWorker = async (outdir: string, dev = false) => {
  for (const { entry, name } of WORKERS) {
    const built = await Bun.build({
      entrypoints: [join(ROOT, 'src', entry)],
      // odgn-ecs loads its Bun database only when asked for one, which a
      // Worker never is
      external: ['bun:sqlite', 'node:fs'],
      format: 'esm',
      minify: !dev,
      naming: { entry: name },
      outdir,
      sourcemap: dev ? 'linked' : 'none',
      target: 'browser'
    });
    if (!built.success) {
      throw new AggregateError(built.logs, `${name} did not build`);
    }
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

#!/usr/bin/env bun
// Builds the arcade page and serves it at http://localhost:5180 (or $PORT).
// The page is cross-origin isolated, as mua-local's is, so sqlite-wasm has
// SharedArrayBuffer when it wants it.
//
//   bun run play
import { join, resolve } from 'node:path';

import { bundle } from './bundle';

const OUT = resolve(import.meta.dir, '../dist');
await bundle(OUT, true);

const headers = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

const server = Bun.serve({
  fetch: req => {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(OUT, path === '/' ? 'index.html' : path));
    return new Response(file, { headers });
  },
  port: Number(process.env.PORT ?? 5180)
});

console.log(`arcade at ${server.url}`);

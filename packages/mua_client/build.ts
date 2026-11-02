// Bundles the client into packages/mua_server/priv/static, which Phoenix
// serves. `--watch` rebuilds on change; `--dev` keeps the development
// sign-in form (the server only offers its route in development and tests).
//
//   bun run build.ts [--watch] [--dev]
import { watch } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dir, '../mua_server/priv/static');
const watching = process.argv.includes('--watch');
const dev = watching || process.argv.includes('--dev');

const build = async () => {
  await rm(OUT, { force: true, recursive: true });
  const result = await Bun.build({
    define: { MUA_DEV: JSON.stringify(dev) },
    entrypoints: [resolve(import.meta.dir, 'index.html')],
    minify: !dev,
    naming: {
      asset: 'assets/[name]-[hash].[ext]',
      chunk: 'assets/[name]-[hash].[ext]',
      entry: '[name].[ext]'
    },
    outdir: OUT,
    publicPath: '/',
    sourcemap: dev ? 'linked' : 'none'
  });
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    if (!watching) {
      process.exit(1);
    }
  }
  console.log(`built ${result.outputs.length} files into ${OUT}`);
};

await build();
if (watching) {
  watch(resolve(import.meta.dir, 'src'), { recursive: true }, () => {
    void build();
  });
}

# mua-local

A Local World: the main mua World run in the browser for solo, offline play ([ADR 0023](../../docs/adr/0023-a-local-world-runs-in-a-worker.md)). A dedicated Web Worker owns the World's sqlite-wasm database, kept in the Origin Private File System, and its NorthTalk, through the TypeScript Host in [`mua-world`](../mua-world). It is the World's single writer. World time advances only while the Worker runs.

The UI talks to the Worker with the Phoenix Channel's messages ([`protocol.ts`](src/protocol.ts), [the protocol](../mua_server/docs/protocol.md)), so `mua_client` can play it as it plays a server's World. It posts `join {name}`, `command {ref, text}`, `logout`, `save` and `load {bytes}`, and hears `output`, `state`, `prompt` and `status`, plus `joined`, `reply`, `saved`, `loaded`, `loadFailed` and `error`.

- **One local Account and Character:** made on the first `join`, kept in the World's `mua_local` table, so a reload plays the same Character. There is no sign-in and no Allowlist, and it never syncs with a server.
- **Its database is its save:** `save` replies `saved` with the World's SQLite file. `load {bytes}` puts a saved file in place of the World and replies `loaded`; `join` again to play it. A World built from an older EDL is migrated before it plays. A file that isn't a saved World gets `loadFailed`, and the World is put back as it was. `createLocalHost` does this, and the Worker only passes it messages.
- **Its files are bundled:** `mua_world`'s EDL and Scripts, and `mua-scripts`, are inlined into the Worker by a Bun macro (`scripts/files.ts`), at virtual paths under `/world` and `/mua-scripts`.

```sh
bun scripts/bundle.ts <outdir>   # worker.js, sqlite3.wasm and sqlite3-opfs-async-proxy.js
bun test src                     # the Local World over Bun's sqlite
bun run e2e                      # the Worker in Chromium, with OPFS
```

The page that starts the Worker must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), since sqlite-wasm's OPFS needs `SharedArrayBuffer`.

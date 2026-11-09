# mua-local

A Local World: the main mua World run in the browser for solo, offline play ([ADR 0023](../../docs/adr/0023-a-local-world-runs-in-a-worker.md)). A dedicated Web Worker owns the World's sqlite-wasm database, kept in the Origin Private File System, and its NorthTalk, through the TypeScript Host in [`mua-world`](../mua-world). It is the World's single writer. World time advances only while the Worker runs.

The UI talks to the Worker with the Phoenix Channel's messages ([`protocol.ts`](src/protocol.ts), [the protocol](../mua_server/docs/protocol.md)), so `mua_client` can play it as it plays a server's World. It posts `join {name}`, `command {ref, text}`, `logout`, `save` and `load {bytes}`, and hears `output`, `state`, `prompt` and `status`, plus `joined`, `reply`, `saved`, `loaded`, `loadFailed` and `error`.

- **One local Account and Character:** made on the first `join`, kept in the World's `mua_local` table, so a reload plays the same Character. There is no sign-in and no Allowlist, and it never syncs with a server.
- **Its database is its save:** `save` replies `saved` with the World's SQLite file. `load {bytes}` puts a saved file in place of the World and replies `loaded`; `join` again to play it. A World built from an older EDL is migrated before it plays. A file that isn't a saved World gets `loadFailed`, and the World is put back as it was. `createLocalHost` does this, and the Worker only passes it messages.
- **Its files are bundled:** `mua_world`'s EDL and Scripts, and `mua-scripts`, are inlined into the Worker by a Bun macro (`scripts/files.ts`), at virtual paths under `/world` and `/mua-scripts`.

## Preview Worlds

A Preview World ([`preview.ts`](src/preview.ts), its Worker [`preview-worker.ts`](src/preview-worker.ts)) is private, in memory and never saved. It is opened from one of three sources:

- **`{edl}`:** built as an empty World is, so it runs commands as the game does, and can be migrated to edited EDL (#243, #165).
- **`{subset}`:** a portable subset of a World, such as a mirror (#164), only to inspect: it has no Scripts underneath.
- **`{tryIt: {mirror, composition}}`:** a builder's composition tried out where their Character stands (#259). It is built from the base EDL (the Base Verbs and mua-scripts' Service Scripts and Libraries), then the mirror and the composition are added with fresh ids and their References remapped. The player's room becomes its starting room, and their Character a stand-in carrying copies of what they carry. A composition may hold only buildable components. `origins` maps each entity back to the composition, the mirror entity it copies, or the stand-in, so a command's changes map back too. What the mirror doesn't hold, such as where an exit leads, is a placeholder, and a command's `outside` lists any it changed or put something in. Reset rebuilds it from the same inputs. Nothing else reaches it: no server World, and no file outside the bundle.

```sh
bun scripts/bundle.ts <outdir>   # worker.js, sqlite3.wasm and sqlite3-opfs-async-proxy.js
bun test src                     # the Local World over Bun's sqlite
bun run e2e                      # the Worker in Chromium, with OPFS
```

The page that starts the Worker must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), since sqlite-wasm's OPFS needs `SharedArrayBuffer`.

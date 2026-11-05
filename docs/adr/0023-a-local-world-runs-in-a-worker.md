# A Local World runs in a Worker

A Local World is one dedicated Web Worker that owns its sqlite-wasm database, stored in OPFS, and its NorthTalk instance. It is the single writer (ADR 0011). The UI talks to it with the same messages as the Phoenix channel, so `mua_client` cannot tell a Local World from a server's World. Its World time advances only while the Worker runs. It has a local Account with no Google identity or Allowlist, and it never syncs with a server's World. Its file is its save: saving exports it and loading imports it, and Migration brings an old file up to date.

## Considered Options

- **Run the World on the main thread.** Rejected: Steps would block rendering, and synchronous OPFS access is only available in a Worker.
- **Sync a Local World with a server's World.** Rejected: two writers to one World breaks ADR 0011, and merging Steps is a problem we have no need to solve.

## Consequences

- Playing mua offline needs its commands in the browser. They move into NorthTalk Scripts, shared by both hosts, rather than being ported to TypeScript, and Local World play waits on that.

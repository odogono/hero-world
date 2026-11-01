# tank-world

A Vite + React client (`src/`, entry `main.tsx`) and a Bun/Elysia server (`src/server/`, port 3001) built on an old `odgn-ecs` API: `src/server/game/components.ts` still calls `defineComponent({ name })`, so its tests fail and it sits outside `bun run check`. Bring it onto the current API before relying on it.

- SQLite WASM needs COOP/COEP headers for `SharedArrayBuffer`. `vite.config.js` sets them for local dev; production needs the same.
- `VITE_WS_URL` overrides the WebSocket URL (`VITE_WS_URL=ws://127.0.0.1:3001/ws bun run dev`). Otherwise the client tries the current origin, then `ws://127.0.0.1:3001/ws`.
- `bun test` picks up the Playwright spec too; run E2E with `bun run test:e2e`, with the dev server started first.

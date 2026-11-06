# arcade

An asteroids-style game run on the ECS at 60 Frames a second. It measures how the store holds up under fast-paced load, and you can play it.

The simulation (`src/sim/`) is 2D, seeded and deterministic. A Frame (`odgn-ecs/loop`) advances World time, runs every due System through the World, and commits once. Events on World time start waves and end the ship's invulnerability.

```sh
bun run bench     # headless: Frame times on Bun's SQLite for K = 100 … 5000 asteroids
bun run play      # the browser game at http://localhost:5180
bun run test      # the simulation
bun run e2e       # the page in Chromium
```

In the browser the World runs in a Web Worker on in-memory sqlite-wasm, as a Local World does ([ADR 0023](../../docs/adr/0023-a-local-world-runs-in-a-worker.md)). After each batch of Frames it posts a snapshot, and the page draws it with Three.js, blending between the last two snapshots. `scripts/bundle.ts` builds the page, the Worker and the sqlite-wasm files into one folder, which must be served cross-origin isolated (COOP and COEP).

Controls: ←/→ or A/D turn, ↑ or W thrust, space fire, R restart.

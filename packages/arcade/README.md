# arcade

An asteroids-style game run on the ECS at 60 Frames a second. It measures how the store holds up under fast-paced load, and you can play it.

The simulation (`src/sim/`) is 2D, seeded and deterministic. A Frame (`odgn-ecs/loop`) advances World time, runs every due System through the World, and commits once. Events on World time start waves and end the ship's invulnerability.

```sh
bun run bench     # headless: Frame times on Bun's SQLite for K = 100 … 5000 asteroids
bun run play      # the browser game at http://localhost:5180
bun run test      # the simulation
bun run e2e       # the page in Chromium
```

## How the game uses the ECS

All of the game's state lives in the World: 8 kinds of component, combined into 4 kinds of entity. Each Frame runs 6 Systems in order and commits once.

### Components (`src/sim/components.ts`)

| Component   | Fields                                               | Meaning                                        |
| ----------- | ---------------------------------------------------- | ---------------------------------------------- |
| `transform` | `x`, `y`, `rotation`                                 | where it is and which way it faces             |
| `velocity`  | `x`, `y`, `spin`                                     | how it moves and turns each second             |
| `collider`  | `radius`                                             | a circle for hit tests                         |
| `asteroid`  | `size` (3 large, 2 medium, 1 small)                  | marks an asteroid and its size                 |
| `bullet`    | `ttl` (ms of World time left)                        | marks a bullet and how long it lives           |
| `ship`      | `lives`, `score`, `wave`, `cooldown`, `invulnerable` | the player's state                             |
| `input`     | `thrust`, `turn`, `fire`                             | this Frame's controls                          |
| `event`     | `type`, `at`, `payload`                              | the ECS's Event component, for one-off moments |

### Entities

| Entity   | Components                                           | How many                                          |
| -------- | ---------------------------------------------------- | ------------------------------------------------- |
| Ship     | `transform`, `velocity`, `collider`, `ship`, `input` | one                                               |
| Asteroid | `transform`, `velocity`, `collider`, `asteroid`      | many, created and destroyed constantly            |
| Bullet   | `transform`, `velocity`, `collider`, `bullet`        | a few at a time, short-lived                      |
| Event    | `event` only                                         | `wave:start` and `ship:vulnerable`, one at a time |

Asteroids and bullets share the same movement and collision components. Only the marker component (`asteroid` or `bullet`) tells them apart, so the Systems pick their entities by which components they have.

### Systems, in Frame order (`src/sim/sim.ts`)

1. **events**: runs due Events. `wave:start` spawns the next wave of large asteroids, and `ship:vulnerable` ends the ship's invulnerability after a hit.
2. **control** (`ship`, `input`, `transform`, `velocity`): turns and thrusts the ship from `input`. When firing is allowed, it creates a bullet entity just ahead of the ship, moving with it.
3. **movement** (`transform`, `velocity`): moves and spins everything that moves, the same way for all three kinds, and wraps it around the screen edges.
4. **bullets** (`bullet`): counts down `ttl` and deletes expired bullets.
5. **collision** (`asteroid`, `bullet` and `ship`, each with `collider` and `transform`): puts asteroids into a grid, then tests bullets and the ship against nearby asteroids.
   - A bullet hit deletes both and scores. A large or medium asteroid splits into two of the next size down.
   - A ship hit costs a life, moves the ship back to the centre, makes it invulnerable, and schedules `ship:vulnerable` for 2 s later.
6. **waves** (`asteroid`): once no asteroids are left, it schedules a `wave:start` Event 1.5 s later.

The headless benchmark and the browser game run this same code. The benchmark adds `godMode` and `steadyAsteroids`, so the load stays the same for the whole run.

## In the browser

In the browser the World runs in a Web Worker on in-memory sqlite-wasm, as a Local World does ([ADR 0023](../../docs/adr/0023-a-local-world-runs-in-a-worker.md)). Each frame, the page sends the keyboard state, which the game writes into `input` before the next Frame. After each batch of Frames, the Worker posts a snapshot of every `transform` and `collider`, and the page draws it with Three.js, blending between the last two snapshots. `scripts/bundle.ts` builds the page, the Worker and the sqlite-wasm files into one folder, which must be served cross-origin isolated (COOP and COEP).

Controls: ←/→ or A/D turn, ↑ or W thrust, space fire, R restart.

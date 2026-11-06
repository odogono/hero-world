import type { DatabaseType } from 'odgn-ecs/db';
import { runEvents, scheduleEvent } from 'odgn-ecs/events';
import { createFrameLoop, type FrameSystem } from 'odgn-ecs/loop';
import { createWorld } from 'odgn-ecs/world';

import { arcadeComponents } from './components';
import { createRng } from './rng';

export const FRAME_MS = 1000 / 60;
export const WIDTH = 1600;
export const HEIGHT = 900;

const ASTEROID_RADIUS = [0, 12, 24, 48];
const ASTEROID_SCORE = [0, 100, 50, 20];
const BULLET_RADIUS = 2;
const BULLET_SPEED = 600;
const BULLET_TTL = 1000;
const FIRE_COOLDOWN = 130;
const SHIP_RADIUS = 14;
const THRUST = 300;
const TURN_SPEED = 4;
const INVULNERABLE_MS = 2000;
const WAVE_DELAY_MS = 1500;
const CELL = 64;

export type InputState = { fire: boolean; thrust: boolean; turn: number };

export type SimOptions = {
  dbType?: DatabaseType;
  /** Benchmark only: the ship never loses a life */
  godMode?: boolean;
  /** Benchmark only: keep at least this many asteroids, topping up each Frame */
  minAsteroids?: number;
  /** A database file; in memory without one */
  path?: string;
  seed?: number;
};

export type EntityKind = 'asteroid' | 'bullet' | 'ship';

export type SnapshotEntry = {
  id: number;
  kind: EntityKind;
  radius: number;
  rotation: number;
  x: number;
  y: number;
};

export type Snapshot = {
  entities: SnapshotEntry[];
  lives: number;
  score: number;
  time: number;
  wave: number;
};

const wrap = (v: number, max: number) =>
  v < 0 ? v + max : v >= max ? v - max : v;

const cellKey = (gx: number, gy: number) => gy * 1024 + gx;

export const createSim = async (options: SimOptions = {}) => {
  const { dbType, godMode = false, minAsteroids = 0, path, seed = 1 } = options;
  const rng = createRng(seed);

  const world = await createWorld(arcadeComponents, {
    ...(dbType ? { dbType } : {}),
    ...(path ? { path } : {})
  });
  type W = typeof world;

  const spawnAsteroid = (size: number, x?: number, y?: number) => {
    const angle = rng() * Math.PI * 2;
    const speed = 30 + rng() * 60 * (4 - size);
    world.create({
      asteroid: { size },
      collider: { radius: ASTEROID_RADIUS[size]! },
      transform: {
        rotation: rng() * Math.PI * 2,
        // Large asteroids arrive at the sides, clear of the ship.
        x:
          x ??
          (rng() < 0.5 ? rng() * WIDTH * 0.2 : WIDTH * (0.8 + rng() * 0.2)),
        y: y ?? rng() * HEIGHT
      },
      velocity: {
        spin: (rng() - 0.5) * 2,
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
      }
    });
  };

  const ship = world.create({
    collider: { radius: SHIP_RADIUS },
    input: { fire: false, thrust: false, turn: 0 },
    ship: { cooldown: 0, invulnerable: false, lives: 3, score: 0, wave: 0 },
    transform: { rotation: -Math.PI / 2, x: WIDTH / 2, y: HEIGHT / 2 },
    velocity: { spin: 0, x: 0, y: 0 }
  });

  const getShip = () =>
    world.query({
      entity: ship,
      with: ['ship', 'input', 'transform', 'velocity']
    });

  const control: FrameSystem<W> = {
    name: 'control',
    run: (w, dtMs) => {
      const e = getShip();
      if (!e || e.ship.lives <= 0) {
        return;
      }
      const dt = dtMs / 1000;
      const { input, ship: s, transform: t, velocity: v } = e;
      t.rotation += input.turn * TURN_SPEED * dt;
      if (input.thrust) {
        v.x += Math.cos(t.rotation) * THRUST * dt;
        v.y += Math.sin(t.rotation) * THRUST * dt;
      }
      v.x *= 0.995;
      v.y *= 0.995;
      s.cooldown = Math.max(0, s.cooldown - dtMs);
      if (input.fire && s.cooldown === 0) {
        s.cooldown = FIRE_COOLDOWN;
        w.create({
          bullet: { ttl: BULLET_TTL },
          collider: { radius: BULLET_RADIUS },
          transform: {
            rotation: t.rotation,
            x: t.x + Math.cos(t.rotation) * SHIP_RADIUS,
            y: t.y + Math.sin(t.rotation) * SHIP_RADIUS
          },
          velocity: {
            spin: 0,
            x: v.x + Math.cos(t.rotation) * BULLET_SPEED,
            y: v.y + Math.sin(t.rotation) * BULLET_SPEED
          }
        });
      }
    }
  };

  const movement: FrameSystem<W> = {
    name: 'movement',
    run: (w, dtMs) => {
      const dt = dtMs / 1000;
      for (const { transform: t, velocity: v } of w.queryAll({
        with: ['transform', 'velocity']
      })) {
        t.x = wrap(t.x + v.x * dt, WIDTH);
        t.y = wrap(t.y + v.y * dt, HEIGHT);
        if (v.spin !== 0) {
          t.rotation += v.spin * dt;
        }
      }
    }
  };

  const bullets: FrameSystem<W> = {
    name: 'bullets',
    run: (w, dtMs) => {
      for (const e of w.queryAll({ with: ['bullet'] })) {
        e.bullet.ttl -= dtMs;
        if (e.bullet.ttl <= 0) {
          w.delete(e);
        }
      }
    }
  };

  // A uniform grid rebuilt every Frame. Spatial indexing is the game's job;
  // the ECS only supplies iteration.
  const collision: FrameSystem<W> = {
    name: 'collision',
    run: w => {
      const asteroids = w.queryAll({
        with: ['asteroid', 'collider', 'transform']
      });
      type Asteroid = (typeof asteroids)[number];
      const grid = new Map<number, Asteroid[]>();
      for (const a of asteroids) {
        const r = a.collider.radius;
        const { x, y } = a.transform;
        for (let gx = Math.floor((x - r) / CELL); gx <= (x + r) / CELL; gx++) {
          for (
            let gy = Math.floor((y - r) / CELL);
            gy <= (y + r) / CELL;
            gy++
          ) {
            const key = cellKey(gx, gy);
            const cell = grid.get(key);
            if (cell) {
              cell.push(a);
            } else {
              grid.set(key, [a]);
            }
          }
        }
      }

      const dead = new Set<number>();
      const hit = (x: number, y: number, radius: number) => {
        const cell = grid.get(
          cellKey(Math.floor(x / CELL), Math.floor(y / CELL))
        );
        for (const a of cell ?? []) {
          if (dead.has(a.id)) {
            continue;
          }
          const dx = a.transform.x - x;
          const dy = a.transform.y - y;
          const rr = a.collider.radius + radius;
          if (dx * dx + dy * dy < rr * rr) {
            return a;
          }
        }
        return undefined;
      };

      const destroy = (a: Asteroid) => {
        dead.add(a.id);
        const { size } = a.asteroid;
        const { x, y } = a.transform;
        w.delete(a);
        if (size > 1) {
          spawnAsteroid(size - 1, x, y);
          spawnAsteroid(size - 1, x, y);
        }
        return ASTEROID_SCORE[size]!;
      };

      let score = 0;
      for (const b of w.queryAll({
        with: ['bullet', 'collider', 'transform']
      })) {
        const a = hit(b.transform.x, b.transform.y, b.collider.radius);
        if (a) {
          w.delete(b);
          score += destroy(a);
        }
      }

      const s = getShip();
      if (!s) {
        return;
      }
      s.ship.score += score;
      if (godMode || s.ship.invulnerable || s.ship.lives <= 0) {
        return;
      }
      const a = hit(s.transform.x, s.transform.y, SHIP_RADIUS);
      if (a) {
        destroy(a);
        s.ship.lives -= 1;
        s.ship.invulnerable = true;
        s.transform.x = WIDTH / 2;
        s.transform.y = HEIGHT / 2;
        s.velocity.x = 0;
        s.velocity.y = 0;
        scheduleEvent(w, 'ship:vulnerable', {}, w.time + INVULNERABLE_MS);
      }
    }
  };

  const waves: FrameSystem<W> = {
    name: 'waves',
    run: w => {
      const count = w.queryAll({ with: ['asteroid'] }).length;
      if (minAsteroids > 0) {
        for (let i = count; i < minAsteroids; i++) {
          spawnAsteroid(3);
        }
        return;
      }
      if (count > 0) {
        return;
      }
      const pending = w.queryAll({
        where: [['event', 'type', 'wave:start']],
        with: ['event']
      });
      if (pending.length === 0) {
        scheduleEvent(w, 'wave:start', {}, w.time + WAVE_DELAY_MS);
      }
    }
  };

  // Events are for one-off moments; per-Frame work stays in the systems.
  const events: FrameSystem<W> = {
    name: 'events',
    run: w =>
      runEvents(
        w,
        ['wave:start', 'ship:vulnerable'],
        ({ type }) => {
          const s = getShip();
          if (!s) {
            return;
          }
          if (type === 'ship:vulnerable') {
            s.ship.invulnerable = false;
          } else {
            s.ship.wave += 1;
            for (let i = 0; i < 3 + s.ship.wave; i++) {
              spawnAsteroid(3);
            }
          }
        },
        // The Frame commits once, at its end
        { flush: false }
      )
  };

  const loop = createFrameLoop(
    world,
    [events, control, movement, bullets, collision, waves],
    { frameMs: FRAME_MS }
  );

  // The first wave starts at once; the ship is safe until it is due to end.
  scheduleEvent(world, 'wave:start', {});
  ship.ship.invulnerable = true;
  scheduleEvent(world, 'ship:vulnerable', {}, INVULNERABLE_MS);
  world.flush();

  const setInput = (input: InputState) => {
    const e = getShip();
    if (e) {
      e.input.fire = input.fire;
      e.input.thrust = input.thrust;
      e.input.turn = input.turn;
    }
  };

  /** Runs one Frame, with this Frame's input */
  const frame = (input?: InputState) => {
    if (input) {
      setInput(input);
    }
    return loop.frame();
  };

  const snapshot = (): Snapshot => {
    const entities: SnapshotEntry[] = [];
    const push = (
      kind: EntityKind,
      e: {
        collider: { radius: number };
        id: number;
        transform: { rotation: number; x: number; y: number };
      }
    ) =>
      entities.push({
        id: e.id,
        kind,
        radius: e.collider.radius,
        rotation: e.transform.rotation,
        x: e.transform.x,
        y: e.transform.y
      });
    for (const e of world.queryAll({
      with: ['asteroid', 'collider', 'transform']
    })) {
      push('asteroid', e);
    }
    for (const e of world.queryAll({
      with: ['bullet', 'collider', 'transform']
    })) {
      push('bullet', e);
    }
    const s = getShip();
    if (s && s.ship.lives > 0) {
      push('ship', { ...s, collider: { radius: SHIP_RADIUS } });
    }
    return {
      entities,
      lives: s?.ship.lives ?? 0,
      score: s?.ship.score ?? 0,
      time: world.time,
      wave: s?.ship.wave ?? 0
    };
  };

  return { frame, snapshot, world };
};

export type Sim = Awaited<ReturnType<typeof createSim>>;

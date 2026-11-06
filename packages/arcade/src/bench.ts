/* eslint-disable no-console */
// The headless benchmark: for each asteroid count K, run a scripted,
// seeded scenario and report Frame times against the 8 ms budget.
//
//   bun run bench                 every variant, K = 100 … 5000
//   bun run bench -- --k 500      one K
//   bun run bench -- --variant memory
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { FrameTiming } from 'odgn-ecs/loop';

import { createSim, type InputState } from './sim/sim';

const BUDGET_MS = 8;
const WARMUP_FRAMES = 60;
const MEASURED_FRAMES = 300;
/** Stop ramping a variant once its median is this far over budget */
const GIVE_UP_MS = BUDGET_MS * 6;

type Variant = 'file' | 'memory' | 'memory-no-triggers';
const VARIANTS: Variant[] = ['memory', 'memory-no-triggers', 'file'];

const { values } = parseArgs({
  options: {
    frames: { type: 'string' },
    k: { type: 'string' },
    variant: { type: 'string' }
  }
});

const ks = values.k
  ? values.k.split(',').map(Number)
  : [100, 250, 500, 1000, 2000, 5000];
const variants = values.variant
  ? (values.variant.split(',') as Variant[])
  : VARIANTS;
const frames = values.frames ? Number(values.frames) : MEASURED_FRAMES;

/** The same input every run: fire constantly, turn, thrust in bursts */
const scriptedInput = (i: number): InputState => ({
  fire: true,
  thrust: i % 120 < 20,
  turn: Math.sin(i / 50)
});

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const median = (xs: number[]) =>
  percentile(
    [...xs].sort((a, b) => a - b),
    0.5
  );

const run = async (variant: Variant, k: number) => {
  const dir =
    variant === 'file' ? mkdtempSync(join(tmpdir(), 'arcade-')) : undefined;
  const sim = await createSim({
    godMode: true,
    minAsteroids: k,
    seed: 42,
    ...(dir ? { path: join(dir, 'world.db') } : {})
  });

  if (variant === 'memory-no-triggers') {
    // Measurement only: what the ecs_changes triggers cost each Frame.
    const triggers = sim.world.db.query(
      "SELECT name FROM sqlite_temp_master WHERE type = 'trigger'"
    ) as { name: string }[];
    for (const { name } of triggers) {
      sim.world.db.exec(`DROP TRIGGER temp.${name}`);
    }
  }

  for (let i = 0; i < WARMUP_FRAMES; i++) {
    sim.frame(scriptedInput(i));
  }

  const timings: FrameTiming[] = [];
  let entities = 0;
  for (let i = 0; i < frames; i++) {
    timings.push(sim.frame(scriptedInput(WARMUP_FRAMES + i)));
    if (i % 30 === 0) {
      entities += sim.snapshot().entities.length;
    }
  }

  sim.world.db.close();
  if (dir) {
    rmSync(dir, { force: true, recursive: true });
  }

  const totals = timings.map(t => t.total).sort((a, b) => a - b);
  const names = Object.keys(timings[0]!.systems);
  return {
    entities: Math.round(entities / Math.ceil(frames / 30)),
    flush: median(timings.map(t => t.flush)),
    median: percentile(totals, 0.5),
    p99: percentile(totals, 0.99),
    systems: Object.fromEntries(
      names.map(n => [n, median(timings.map(t => t.systems[n] ?? 0))])
    )
  };
};

const fmt = (ms: number) => ms.toFixed(2).padStart(7);

console.log(
  `Frame budget ${BUDGET_MS} ms; ${WARMUP_FRAMES} warm-up + ${frames} measured Frames; Bun ${Bun.version}\n`
);

for (const variant of variants) {
  console.log(`## ${variant}`);
  console.log(
    '      K  entities   median     p99    flush  | per system (median ms)'
  );
  for (const k of ks) {
    const r = await run(variant, k);
    const systems = Object.entries(r.systems)
      .map(([n, ms]) => `${n} ${ms.toFixed(2)}`)
      .join(', ');
    const mark = r.p99 <= BUDGET_MS ? ' ' : r.median <= BUDGET_MS ? '~' : '✗';
    console.log(
      `${String(k).padStart(7)} ${String(r.entities).padStart(9)} ${fmt(r.median)} ${fmt(r.p99)} ${fmt(r.flush)} ${mark}| ${systems}`
    );
    if (r.median > GIVE_UP_MS) {
      console.log('        (stopping: far over budget)');
      break;
    }
  }
  console.log();
}
console.log(
  '  = p99 within budget   ~ median within, p99 over   ✗ median over'
);

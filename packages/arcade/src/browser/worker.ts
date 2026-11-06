/// <reference lib="webworker" />
/**
 * Runs the arcade World in a Web Worker on in-memory sqlite-wasm, as a Local
 * World does (ADR 0023), so Frames never block rendering. It runs Frames at
 * a fixed 60 a second of real time and posts a snapshot after each batch.
 */
import { FRAME_MS, createSim, type InputState, type Sim } from '../sim/sim';
import { KIND, STRIDE, type FromWorker, type ToWorker } from './protocol';

/** Never run more than this many Frames to catch up, so a stall can't spiral */
const MAX_CATCH_UP = 5;

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const send = (message: FromWorker, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

let sim: Sim | undefined;
let input: InputState = { fire: false, thrust: false, turn: 0 };
let last = performance.now();
let owed = 0;
const recent: number[] = [];

const start = async (seed: number) => {
  const old = sim;
  sim = undefined;
  old?.world.db.close();
  sim = await createSim({ dbType: 'wasm', seed });
  last = performance.now();
  owed = 0;
};

const post = (current: Sim) => {
  const snap = current.snapshot();
  const entities = new Float32Array(snap.entities.length * STRIDE);
  snap.entities.forEach((e, i) => {
    entities.set(
      [KIND[e.kind], e.id, e.x, e.y, e.rotation, e.radius],
      i * STRIDE
    );
  });
  const sorted = [...recent].sort((a, b) => a - b);
  send(
    {
      entities,
      frameMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      lives: snap.lives,
      score: snap.score,
      time: snap.time,
      type: 'frame',
      wave: snap.wave
    },
    [entities.buffer]
  );
};

const pump = () => {
  const current = sim;
  if (!current) {
    return;
  }
  const now = performance.now();
  owed = Math.min(owed + (now - last), FRAME_MS * MAX_CATCH_UP);
  last = now;
  if (owed < FRAME_MS) {
    return;
  }
  try {
    while (owed >= FRAME_MS) {
      owed -= FRAME_MS;
      recent.push(current.frame(input).total);
      if (recent.length > 60) {
        recent.shift();
      }
    }
    post(current);
  } catch (error) {
    send({
      message: error instanceof Error ? error.message : String(error),
      type: 'error'
    });
  }
};

scope.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'input') {
    ({ input } = message);
  } else {
    void start(message.seed).catch(report);
  }
});

setInterval(pump, 4);
const report = (error: unknown) =>
  send({
    message: error instanceof Error ? error.message : String(error),
    type: 'error'
  });

try {
  await start(Date.now() % 100_000);
} catch (error) {
  report(error);
}

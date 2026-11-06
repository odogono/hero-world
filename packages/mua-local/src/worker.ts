/// <reference lib="webworker" />
/**
 * A Local World's Web Worker (ADR 0023): it owns the World's sqlite-wasm
 * database in OPFS and its NorthTalk, and is the World's single writer
 * (ADR 0011). The UI posts `ToWorld` messages and hears `FromWorld` ones.
 * World time advances only while the Worker runs.
 */
// a macro: the World's files are read and inlined when the Worker is bundled
import { worldFiles } from '../scripts/files' with { type: 'macro' };
import { openLocalWorld, type LocalWorld } from './local';
import type { FromWorld, ToWorld } from './protocol';

const TICK_MS = 100;
const DATABASE = 'mua-local-world.db';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const send = (message: FromWorld) => scope.postMessage(message);

let opened: Promise<LocalWorld> | undefined;

// Messages are handled one at a time, in the order they came
let queue: Promise<unknown> = Promise.resolve();

const open = () => {
  opened ??= openLocalWorld({
    database: { opfs: true, path: `/${DATABASE}`, type: 'wasm' },
    files: worldFiles(),
    send
  }).then(world => {
    setInterval(() => {
      queue = queue.then(() => world.tick()).catch(report);
    }, TICK_MS);
    return world;
  });
  return opened;
};

const report = (error: unknown) =>
  send({
    event: 'error',
    message: error instanceof Error ? error.message : String(error)
  });

scope.addEventListener('message', (event: MessageEvent<ToWorld>) => {
  queue = queue
    .then(async () => (await open()).receive(event.data))
    .catch(report);
});

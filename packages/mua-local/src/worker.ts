/// <reference lib="webworker" />
/**
 * A Local World's Web Worker (ADR 0023): it owns the World's sqlite-wasm
 * database in OPFS and its NorthTalk, and is the World's single writer
 * (ADR 0011). The UI posts `ToWorld` messages and hears `FromWorld` ones.
 * World time advances only while the Worker runs.
 */
// a macro: the World's files are read and inlined when the Worker is bundled
import {
  worldFiles,
  worldPictures
} from '../scripts/files' with { type: 'macro' };
import { createLocalHost } from './local';
import type { FromWorld, ToWorld } from './protocol';

const TICK_MS = 100;
const DATABASE = 'mua-local-world.db';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

const send = (message: FromWorld) =>
  // a save's bytes are moved, not copied
  message.event === 'saved'
    ? scope.postMessage(message, [message.bytes.buffer])
    : scope.postMessage(message);

const report = (error: unknown) =>
  send({
    event: 'error',
    message: error instanceof Error ? error.message : String(error)
  });

const host = createLocalHost({
  database: { opfs: true, path: `/${DATABASE}`, type: 'wasm' },
  files: worldFiles(),
  pictures: worldPictures(),
  send
});

// Messages and ticks are handled one at a time, in the order they came
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (fn: () => unknown) => {
  queue = queue.then(fn).catch(report);
};

setInterval(() => enqueue(() => host.tick()), TICK_MS);

scope.addEventListener('message', (event: MessageEvent<ToWorld>) =>
  enqueue(() => host.receive(event.data))
);

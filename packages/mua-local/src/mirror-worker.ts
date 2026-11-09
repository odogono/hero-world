/// <reference lib="webworker" />
/**
 * The Web Worker that holds a client's mirror of the server's World (#164):
 * an in-memory sqlite-wasm World of what the Character perceives. The UI
 * posts the server's `mirror` and `changes` messages to it, in order.
 */
import { openMirror, type Mirror, type ToMirror } from './mirror';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

const opened: Promise<Mirror> = openMirror({ path: ':memory:', type: 'wasm' });
// a change set that comes before any snapshot has nothing to apply to; the
// snapshot that follows it holds it already
let loaded = false;

let queue: Promise<unknown> = Promise.resolve();

scope.addEventListener('message', (event: MessageEvent<ToMirror>) => {
  const message = event.data;
  queue = queue
    .then(async () => {
      const mirror = await opened;
      if (message.type === 'load') {
        mirror.load(message.snapshot);
        loaded = true;
      } else if (loaded) {
        mirror.apply(message.changes);
      }
    })
    .catch((error: unknown) => {
      // out of step with the server now: wait for the next fresh snapshot
      loaded = false;
      scope.reportError(error);
    });
});

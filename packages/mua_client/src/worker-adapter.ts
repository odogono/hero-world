/**
 * A Local World in this browser's Web Worker (ADR 0023): the Connection's
 * adapter for playing offline. A save is offered to the browser as a file.
 */
import type { FromWorld } from 'mua-local';

import { localAdapter } from './local-adapter';

// Offers a save to the browser to keep, as a file
const download = (bytes: Uint8Array) => {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mua-world.db';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Plays the Local World's Character, made with `name` the first time */
export const workerAdapter = (name: string) => {
  const worker = new Worker('/local/worker.js', { type: 'module' });
  const { adapter, receive } = localAdapter({
    close: () => worker.terminate(),
    keep: download,
    name,
    post: message =>
      message.type === 'load'
        ? // a save's bytes are moved, not copied
          worker.postMessage(message, [message.bytes.buffer])
        : worker.postMessage(message)
  });
  worker.addEventListener('message', ({ data }: MessageEvent<FromWorld>) =>
    receive(data)
  );
  // a Worker that died stops the World as one that reported an error does,
  // giving up on whatever it was asked (#313)
  worker.addEventListener('error', event =>
    receive({ event: 'error', message: event.message })
  );
  return adapter;
};

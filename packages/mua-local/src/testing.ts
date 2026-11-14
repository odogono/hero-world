/**
 * For other packages' tests, without a browser: a Local World's host in
 * this process, on Bun's sqlite in memory, to play the main World (#304),
 * and a mirror's Worker (#314). Nothing ticks the host: tests call `tick`
 * themselves.
 */
import { DatabaseType } from 'odgn-ecs/db';

import { worldFiles, worldPictures } from '../scripts/files';
import { serve, type WorkerLike } from './endpoint';
import { createLocalHost } from './local';
import {
  mirrorHandler,
  openMirror,
  type MirrorReplies,
  type ToMirror
} from './mirror';
import type { FromWorld } from './protocol';

/**
 * `path` keeps the World in a file, as loading a save needs; in memory by
 * default
 */
export const openTestHost = (
  send: (message: FromWorld) => void,
  path = ':memory:'
) =>
  createLocalHost({
    clock: () => 0,
    database: { path, type: DatabaseType.BUN },
    files: worldFiles(),
    pictures: worldPictures(),
    send
  });

/**
 * A mirror's Worker in this process (#314): the real mirror handler on
 * Bun's sqlite, served over a MessageChannel. `kill` makes it die as a
 * Worker does, with an `error` event.
 */
export const openTestMirrorWorker = () => {
  const { port1: page, port2: inside } = new MessageChannel();
  serve<ToMirror, MirrorReplies>(
    inside,
    mirrorHandler(openMirror({ path: ':memory:', type: DatabaseType.BUN }))
  );
  inside.start();

  const events = new EventTarget();
  page.addEventListener('message', event =>
    events.dispatchEvent(new MessageEvent('message', { data: event.data }))
  );
  page.start();
  const worker: WorkerLike & { kill: () => void } = {
    addEventListener: (type, listener) =>
      events.addEventListener(type, listener),
    kill: () =>
      events.dispatchEvent(new ErrorEvent('error', { message: 'killed' })),
    postMessage: message => page.postMessage(message),
    terminate: () => {
      page.close();
      inside.close();
    }
  };
  return worker;
};

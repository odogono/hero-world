/**
 * A Local World's host in this process, on Bun's sqlite in memory, for
 * other packages' tests to play the main World without a browser (#304).
 * Nothing ticks it: tests call `tick` themselves.
 */
import { DatabaseType } from 'odgn-ecs/db';

import { worldFiles, worldPictures } from '../scripts/files';
import { createLocalHost } from './local';
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

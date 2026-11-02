import type { World } from 'odgn-ecs/world';

import type { Notice } from '../actions/types';
import type { MuaComponents } from '../coms';
import { entitiesIn } from '../queries/entity';
import type { ScriptRunner } from './runner';

/**
 * Sends a notice to the Scripts of the things in its place, except the one
 * it is about (its first argument), such as the actor who arrived.
 */
export const sendNotice = (
  world: World<MuaComponents>,
  scripts: ScriptRunner,
  { args, message, to }: Notice
) => {
  const first = args[0];
  const about = typeof first === 'object' ? first.entity : undefined;
  for (const watcher of entitiesIn(world, to)) {
    if (watcher !== about && scripts.hasScript(watcher)) {
      scripts.notify(watcher, message, args);
    }
  }
};

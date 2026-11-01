import type { EcsTalk } from 'ecs-talk';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import type { MuaComponents } from '../coms';

const log = createLog('scripts');

/**
 * Loads the Script of every atom whose EDL declares a `script` component,
 * and returns the names of those atoms. Scripts owned by a single entity
 * aren't supported by ecs-talk yet, so they are skipped with a warning.
 */
export const loadScripts = async (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk
): Promise<Set<string>> => {
  const scripted = new Set<string>();
  for (const owner of world.getScriptOwners()) {
    if (owner.kind !== 'atom') {
      log.warn(
        `Skipping the Script of entity ${owner.eid} (${owner.src}): ` +
          'only atoms can own Scripts for now'
      );
      continue;
    }
    const file = Bun.file(owner.src);
    if (!(await file.exists())) {
      throw new Error(`Script for atom ${owner.name} not found: ${owner.src}`);
    }
    ecsTalk.loadAtomScript(owner.name, await file.text());
    scripted.add(owner.name);
    log.info(`Loaded Script for atom ${owner.name} from ${owner.src}`);
  }
  return scripted;
};

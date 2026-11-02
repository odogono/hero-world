import type { EcsTalk } from 'ecs-talk';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import type { MuaComponents } from '../coms';
import { createCommandContexts, type CommandContexts } from './commands';
import { createMuaCapability, type NoticeHook } from './mua-capability';

const log = createLog('scripts');

const behaviour = (path: string) =>
  new URL(`../behaviours/${path}`, import.meta.url).pathname;

/** mua's own Libraries, by the name Scripts `use` them from */
const LIBRARIES: Record<string, string> = {
  rooms: behaviour('lib/rooms.talk'),
  things: behaviour('lib/things.talk')
};

/**
 * mua's Service Scripts, by name: its core actions, written in NorthTalk.
 * No entity's Message Path reaches them; dispatch sends to them by name
 * (see actions/scripted.ts).
 */
const SERVICES: Record<string, string> = {
  exit: behaviour('exit.talk'),
  room: behaviour('room.talk')
};

export type LoadedScripts = {
  /** The atoms that own a Script */
  atoms: Set<string>;
  /** The Service Scripts loaded */
  services: Set<string>;
};

/**
 * Loads mua's Libraries and Service Scripts, then the Script of every atom
 * whose EDL declares a `script` component. Scripts owned by a single entity
 * aren't supported by ecs-talk yet, so they are skipped with a warning.
 */
export const loadScripts = async (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk<MuaComponents>,
  contexts: CommandContexts = createCommandContexts(),
  hook: NoticeHook = {}
): Promise<LoadedScripts> => {
  const atoms = new Set<string>();
  const services = new Set<string>();
  const mua = createMuaCapability(world, ecsTalk, contexts, hook);
  const grants = () => ({
    mua: mua.grant(
      ['act', 'announce', 'command', 'message', 'notice'],
      undefined
    )
  });

  // the Libraries every Script may `use`
  for (const [name, path] of Object.entries(LIBRARIES)) {
    ecsTalk.addLibrary(name, await Bun.file(path).text(), [], [mua]);
    log.info(`Loaded Library ${name} from ${path}`);
  }
  for (const [name, path] of Object.entries(SERVICES)) {
    ecsTalk.loadServiceScript(name, await Bun.file(path).text(), {
      grants: grants()
    });
    services.add(name);
    log.info(`Loaded Service ${name} from ${path}`);
  }
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
    ecsTalk.loadAtomScript(owner.name, await file.text(), {
      grants: grants()
    });
    atoms.add(owner.name);
    log.info(`Loaded Script for atom ${owner.name} from ${owner.src}`);
  }
  return { atoms, services };
};

import {
  TALK_SHOW_EVENT,
  createEcsTalk,
  type EcsTalk,
  type TalkShowPayload
} from 'ecs-talk';
import { createEventSystem } from 'odgn-ecs/events';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import type { MuaComponents } from './coms';

const log = createLog('mua-talk');

/**
 * Create the World's Script Group and load the Script of every atom whose EDL
 * declares one. Call after `executeEDL` with the EDL file's path.
 */
export const createMuaTalk = async (world: World<MuaComponents>) => {
  const talk = createEcsTalk(world, {
    name: 'mua',
    onPump: result => {
      for (const report of result.reports) {
        if (report.kind === 'run end' && report.outcome === 'errored') {
          log.error('Script Run failed', report.error);
        }
      }
    }
  });

  for (const owner of world.getScriptOwners()) {
    if (owner.kind !== 'atom') {
      log.warn(`Entity ${owner.eid} owns a Script; only atom Scripts load`);
      continue;
    }
    const source = await Bun.file(owner.src).text();
    talk.loadAtomScript(owner.name, source);
    log.info(`Loaded ${owner.src} for atom ${owner.name}`);
  }

  return talk;
};

/** Send an output line to a player's connection, if they are connected */
export const sendToPlayer = (
  world: World<MuaComponents>,
  playerId: EntityId,
  message: string
) => {
  const player = world.query({
    entity: { id: playerId, world } as never,
    with: ['player']
  });
  if (!player?.player.connectedId) {
    return;
  }
  const connection = world.query({
    entity: { id: player.player.connectedId, world } as never,
    with: ['connected']
  });
  if (!connection) {
    return;
  }
  world.create({
    outputEvent: {
      broadcast: false,
      message,
      wsId: connection.connected.wsId
    }
  });
};

/** Turn each `show actor, text` from a Script into an `outputEvent` */
export const createShowSystem = () =>
  createEventSystem<MuaComponents>(TALK_SHOW_EVENT, ({ payload, world }) => {
    const { actor, text } = payload as TalkShowPayload;
    sendToPlayer(world, actor, text);
  });

export type MuaTalk = EcsTalk;

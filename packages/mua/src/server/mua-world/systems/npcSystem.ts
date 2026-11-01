import { createLog } from 'odgn-helpers/log';

import { bindCommand } from '../commands/bind';
import { parseCommand } from '../commands/parser';
import { vocabularyOf } from '../commands/verbs';
import { getEntity } from '../queries/entity';
import { createMuaSystem } from './create-mua-system';

const log = createLog('npcs');

/**
 * Turns the commands NPC Scripts asked for into command events, as the
 * parse system does for players. An NPC has no one to ask "which do you
 * mean?", so an ambiguous object means its first match, and a command that
 * can't be understood is dropped.
 */
export const npcSystem = createMuaSystem(
  ({ entity, world }) => {
    const { actorId: actor, text } = entity.npcInput;
    world.delete(entity);
    const actorId = actor ?? undefined;
    if (actorId === undefined) {
      return;
    }

    const npc = getEntity(world, actorId, ['npc']);
    if (!npc?.npc.active) {
      return;
    }
    const parsed = parseCommand(text, vocabularyOf(world));
    if (!parsed.success) {
      log.debug(`NPC ${actorId} can't ${text}: ${parsed.error}`);
      return;
    }
    let bound = bindCommand({ actorId, command: parsed.command, world });
    if (bound.kind === 'ambiguous') {
      const { pending } = bound;
      bound = bindCommand({
        actorId,
        command: pending.command,
        resolved: {
          ...pending.resolved,
          [pending.slot]: pending.options[0]!.id
        },
        world
      });
    }
    if (bound.kind !== 'bound') {
      log.debug(`NPC ${actorId} can't ${text}: ${bound.message}`);
      return;
    }
    for (const command of bound.commands) {
      world.create({
        commandEvent: {
          direction: command.direction,
          indirect: command.indirect,
          indirectId: command.indirectId,
          label: command.label,
          playerId: actorId,
          rawInput: command.rawInput,
          target: command.target,
          targetId: command.targetId,
          text: command.text,
          verb: command.verb
        }
      });
    }
  },
  { frequency: 1, priority: 30, with: ['npcInput'] }
);

import type { EcsTalk } from 'ecs-talk';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import { defineCapability, map, nothing, shape, text } from '@northtalk/ts';

import type { MuaComponents } from '../coms';
import { tell } from '../systems/output';
import type { CommandContexts } from './commands';

const textOf = (value: string | undefined) =>
  value === undefined || value === null ? nothing : text(value);

/**
 * mua's own Capability for Scripts:
 * - `act actor, command` has an NPC carry out a command as a player would,
 *   e.g. `tell mua to act the target, "say Welcome!"`. It runs next tick,
 *   through the same parsing, receivers and vetoes as a player's command.
 * - `command` gives the command the Script is handling, as a map of `verb`,
 *   `actor`, `target`, `indirect`, `text` and `direction` (Nothing for any
 *   it doesn't have), or Nothing outside a command. So `on unlock role,
 *   actor` can find the key in `the indirect of it` after
 *   `ask mua to command`.
 * - `announce place, text, except` tells everyone in a place, but for
 *   `except` (which may be Nothing): `tell mua to announce the location of
 *   actor, "bob waves.", actor`.
 */
export const createMuaCapability = (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk<MuaComponents>,
  contexts: CommandContexts
) => {
  const entity = shape.object(ecsTalk.entityKind);
  const handleOf = (id: EntityId | undefined) =>
    id === undefined || id === null ? nothing : ecsTalk.handle(id).value;

  return defineCapability('mua', {
    act: {
      args: [entity, shape.text],
      command: true,
      cost: { fuel: 1 },
      fire: (_call, actor, text) => {
        world.create({ npcInput: { actorId: actor.native.eid, text } });
      },
      mode: 'fire-and-forget'
    },
    announce: {
      args: [entity, shape.text, shape.optional(entity)],
      command: true,
      cost: { fuel: 1 },
      fire: (_call, place, line, except) => {
        tell(world, place.native.eid, line, { exclude: except?.native.eid });
      },
      mode: 'fire-and-forget'
    },
    command: {
      args: [],
      cost: { fuel: 1 },
      do: call => {
        const context = contexts.get(call.delivery);
        if (!context) {
          return nothing;
        }
        return map([
          ['actor', handleOf(context.actor)],
          ['direction', textOf(context.direction)],
          ['indirect', handleOf(context.indirect)],
          ['target', handleOf(context.target)],
          ['text', textOf(context.text)],
          ['verb', text(context.verb)]
        ]);
      },
      mode: 'immediate',
      result: shape.any
    }
  });
};

import type { EcsTalk } from 'ecs-talk';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import { defineCapability, map, nothing, shape, text } from '@northtalk/ts';

import { messageFor } from '../actions/messages';
import type { MuaComponents } from '../coms';
import { tell } from '../systems/output';
import type { CommandContexts } from './commands';

/** What `notice` does, set once the Script runner exists */
export type NoticeHook = {
  notice?: (place: EntityId, message: string, who: EntityId) => void;
};

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
 * - `message handler, kind, indirect, owner` renders a built-in message for the
 *   command being handled: `kind` is "msg" (for the actor) or "omsg" (for
 *   everyone else), from the target's `messages` or the defaults (see
 *   actions/messages.ts). `indirect`, which may be Nothing, stands in for the
 *   command's second object, as when a Script picks a key itself.
 *   `owner`, if given, is the entity whose `messages` are used in place of
 *   the target's, as the exit is for `move`.
 * - `announce place, text, except` tells everyone in a place, but for
 *   `except` (which may be Nothing): `tell mua to announce the location of
 *   actor, "bob waves.", actor`.
 * - `notice place, message, who` sends `message who` to the Scripts of the
 *   things in a place but `who`, as a notice (see actions/types.ts): `tell
 *   mua to notice destination, "arrived", actor`.
 */
export const createMuaCapability = (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk<MuaComponents>,
  contexts: CommandContexts,
  hook: NoticeHook = {}
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
    },
    message: {
      args: [
        shape.text,
        shape.text,
        shape.optional(entity),
        shape.optional(entity)
      ],
      cost: { fuel: 1 },
      do: (call, handler, kind, indirect, owner) => {
        const context = contexts.get(call.delivery);
        if (!context || (kind !== 'msg' && kind !== 'omsg')) {
          return nothing;
        }
        const rendered = messageFor(
          {
            direction: context.direction,
            indirectId: indirect?.native.eid ?? context.indirect,
            playerId: context.actor,
            targetId: context.target,
            text: context.text,
            verb: context.verb,
            world
          },
          handler,
          kind,
          owner?.native.eid ?? context.target
        );
        return textOf(rendered);
      },
      mode: 'immediate',
      result: shape.any
    },
    notice: {
      args: [entity, shape.text, entity],
      command: true,
      cost: { fuel: 1 },
      fire: (_call, place, message, who) => {
        hook.notice?.(place.native.eid, message, who.native.eid);
      },
      mode: 'fire-and-forget'
    }
  });
};

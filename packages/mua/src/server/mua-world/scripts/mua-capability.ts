import type { EcsTalk } from 'ecs-talk';
import type { World } from 'odgn-ecs/world';

import { defineCapability, shape } from '@northtalk/ts';

import type { MuaComponents } from '../coms';

/**
 * mua's own Capability for Scripts:
 * - `act actor, command` has an NPC carry out a command as a player would,
 *   e.g. `tell mua to act the target, "say Welcome!"`. It runs next tick,
 *   through the same parsing, receivers and vetoes as a player's command.
 */
export const createMuaCapability = (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk<MuaComponents>
) =>
  defineCapability('mua', {
    act: {
      args: [shape.object(ecsTalk.entityKind), shape.text],
      command: true,
      cost: { fuel: 1 },
      fire: (_call, actor, text) => {
        world.create({ npcInput: { actorId: actor.native.eid, text } });
      },
      mode: 'fire-and-forget'
    }
  });

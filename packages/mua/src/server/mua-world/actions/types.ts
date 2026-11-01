import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

export type ActionContext = {
  direction?: string;
  indirect?: string;
  /** The entity the indirect phrase was bound to */
  indirectId?: EntityId;
  playerId: EntityId;
  target?: string;
  /** The entity the target phrase was bound to */
  targetId?: EntityId;
  text?: string;
  verb: string;
  world: World<MuaComponents>;
};

export type ActionResult = {
  broadcast?: {
    /** Someone in the room who should not receive the message */
    exclude?: EntityId;
    message: string;
    roomId: EntityId;
  };
  message: string;
};

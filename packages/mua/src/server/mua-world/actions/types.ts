import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

export type ActionContext = {
  direction?: string;
  indirect?: string;
  playerId: EntityId;
  target?: string;
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

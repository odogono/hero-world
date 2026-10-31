import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

export type ActionContext = {
  direction?: string;
  playerId: EntityId;
  target?: string;
  verb: string;
  world: World<MuaComponents>;
};

export type ActionResult = {
  broadcast?: {
    message: string;
    roomId: EntityId;
  };
  message: string;
};

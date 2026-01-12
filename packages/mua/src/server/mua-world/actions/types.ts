import type { EntityId, World } from 'odgn-ecs/types';

export type ActionContext = {
  world: World<any>;
  playerId: EntityId;
  verb: string;
  target?: string;
  direction?: string;
};

export type ActionResult = {
  message: string;
  broadcast?: {
    message: string;
    roomId: EntityId;
  };
};

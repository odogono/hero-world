import type { EntityId, World } from 'odgn-ecs/types';

export type ActionContext = {
  direction?: string;
  playerId: EntityId;
  target?: string;
  verb: string;
  world: World<any>;
};

export type ActionResult = {
  broadcast?: {
    message: string;
    roomId: EntityId;
  };
  message: string;
};

import { queryEntity, queryEntities } from 'odgn-ecs/entity';
import { createEventSystem } from 'odgn-ecs/events';
import { createLog } from 'odgn-helpers/log';

import type { TankEvents } from '../types';
import type { TankWorld, World, ScheduleEvent } from '../world';

const log = createLog('command-system');

export const moveUnit = (
  { scheduleEvent }: TankWorld,
  id: number,
  targetX: number,
  targetY: number
) => {
  scheduleEvent('cmd:move', { id, targetX, targetY });
};

export const commandSystem = createEventSystem(
  ['cmd:*', 'query:*'],
  ({ payload, type, world, execAdditional }) => {
    const moveCmd = payload as TankEvents['cmd:move'];
    const queryCmd = payload as TankEvents['query:world_state'];

    switch (type) {
      case 'cmd:move':
        issueMoveOrder(world, moveCmd.id, moveCmd.targetX, moveCmd.targetY);
        break;
      case 'query:world_state':
        handleWorldStateQuery(world, queryCmd.requestId, execAdditional.scheduleEvent);
        break;
    }
  }
);

const issueMoveOrder = (
  world: World,
  id: number,
  targetX: number,
  targetY: number
) => {
  log.debug(`Issuing move order for tank ${id} to ${targetX}, ${targetY}`);

  const unit = queryEntity(world, {
    args: [id],
    asProxy: true,
    where: 'position.eid = ?',
    with: ['position', 'velocity']
  });

  if (!unit) {
    log.error(`unit ${id} not found`);
    return;
  }

  unit.moveOrder = {
    createdAt: Date.now(),
    isCompleted: false,
    target: unit.id,
    x: targetX,
    y: targetY
  };
};

const handleWorldStateQuery = (world: World, requestId: number, scheduleEvent: ScheduleEvent) => {
  log.debug(`Handling world state query for request ${requestId}`);
  
  // Query all tanks with their components
  const tanks = queryEntities(world, { 
    with: ['position', 'velocity', 'health', 'team'] 
  });
  
  const worldState = tanks.map(tank => ({
    id: tank.id,
    x: tank.position?.x ?? 0,
    y: tank.position?.y ?? 0,
    velocityX: tank.velocity?.x ?? 0,
    velocityY: tank.velocity?.y ?? 0,
    maxVelocityX: tank.velocity?.speed ?? 0,
    maxVelocityY: tank.velocity?.speed ?? 0,
    health: tank.health?.health ?? 0,
    maxHealth: tank.health?.maxHealth ?? 100,
    team: tank.team?.team ?? 'red',
    hasActiveOrder: !!tank.moveOrder
  }));
  
  // Schedule response event
  scheduleEvent('world_state:response', {
    requestId,
    tanks: worldState
  });
};

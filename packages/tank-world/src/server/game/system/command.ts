import { queryEntities, queryEntity } from 'odgn-ecs/entity';
import { createEventSystem } from 'odgn-ecs/events';
import { createLog } from 'odgn-helpers/log';

import type { TankEvents } from '../types';
import type { ScheduleEvent, TankWorld, World } from '../world';

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
  ({ execAdditional, payload, type, world }) => {
    const moveCmd = payload as TankEvents['cmd:move'];
    const queryCmd = payload as TankEvents['query:world_state'];

    switch (type) {
      case 'cmd:move':
        issueMoveOrder(world, moveCmd.id, moveCmd.targetX, moveCmd.targetY);
        break;
      case 'query:world_state':
        // Use the scheduleEvent from execAdditional if available, otherwise skip
        if (execAdditional?.scheduleEvent) {
          handleWorldStateQuery(
            world,
            queryCmd.requestId,
            execAdditional.scheduleEvent
          );
        } else {
          log.warn('scheduleEvent not available in execAdditional');
        }
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

const handleWorldStateQuery = (
  world: World,
  requestId: number,
  scheduleEvent: ScheduleEvent
) => {
  log.debug(`Handling world state query for request ${requestId}`);

  // Query all tanks with their components
  const tanks = queryEntities(world, {
    with: ['position', 'velocity', 'health', 'team']
  });

  const worldState = tanks.map(tank => ({
    hasActiveOrder: !!tank.moveOrder,
    health: tank.health?.health ?? 0,
    id: tank.id,
    maxHealth: tank.health?.maxHealth ?? 100,
    maxVelocityX: tank.velocity?.speed ?? 0,
    maxVelocityY: tank.velocity?.speed ?? 0,
    team: tank.team?.team ?? 'red',
    velocityX: tank.velocity?.x ?? 0,
    velocityY: tank.velocity?.y ?? 0,
    x: tank.position?.x ?? 0,
    y: tank.position?.y ?? 0
  }));

  // Schedule response event
  scheduleEvent('world_state:response', {
    requestId,
    tanks: worldState
  });
};

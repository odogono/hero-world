import { removeComponent } from 'odgn-ecs/component';
import { createSystem } from 'odgn-ecs/system';
import { createLog } from 'odgn-helpers/log';

const log = createLog('movement-system');

export const movementSystem = createSystem(
  ({ deltaTime, entity, scheduleEvent }) => {
    const deltaSeconds = deltaTime / 1000;
    // log.debug('move', entity.id, entity.moveOrder);

    // Calculate vector to target
    const dx = entity.moveOrder.x - entity.position.x;
    const dy = entity.moveOrder.y - entity.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // log.debug('distance', distance);

    // If close enough to target, complete the order
    if (distance < 2) {
      entity.position.x = entity.moveOrder.x;
      entity.position.y = entity.moveOrder.y;
      entity.velocity.x = 0;
      entity.velocity.y = 0;
      // entity.moveOrder.isCompleted = true;
      removeComponent(entity, 'moveOrder');

      const { x, y } = entity.position;

      // Emit completion event
      scheduleEvent('tank:movement_completed', {
        tankId: entity.id,
        x,
        y
      });

      log.debug(
        `Tank ${entity.id} reached target (${x.toFixed(1)}, ${y.toFixed(1)})`
      );
      return;
    }

    // Calculate velocity vector
    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;

    const { speed, x: vx, y: vy } = entity.velocity;

    entity.velocity.x = normalizedDx * speed;
    entity.velocity.y = normalizedDy * speed;

    // Update position
    // log.debug('velocity', entity.velocity.x, entity.velocity.y);
    // log.debug(
    //   'updating position',
    //   entity.velocity.x * deltaSeconds,
    //   entity.velocity.y * deltaSeconds,
    //   deltaSeconds
    // );
    entity.position.x += entity.velocity.x * deltaSeconds;
    entity.position.y += entity.velocity.y * deltaSeconds;
  },
  { with: ['position', 'velocity', 'moveOrder'] }
);

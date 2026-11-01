import { dispatchCommand } from '../actions';
import { getEntity } from '../queries/entity';
import type { MuaTalk } from '../talk';
import { createMuaSystem } from './create-mua-system';

/** Runs each parsed command; actions that need Scripts run them through `talk` */
export const createActionSystem = (talk?: MuaTalk) =>
  createMuaSystem(
    ({ entity, world }) => {
      if (!entity.commandEvent) {
        return;
      }

      const {
        direction,
        indirect,
        indirectId,
        label,
        playerId,
        target,
        targetId,
        text,
        verb
      } = entity.commandEvent;

      // Execute action
      const outcome = dispatchCommand({
        direction,
        indirect,
        indirectId: indirectId ?? undefined,
        playerId,
        talk,
        target,
        targetId: targetId ?? undefined,
        text,
        verb,
        world
      });

      // Get player's connection
      // read-only: parseSystem owns writes to the player this frame
      const player = getEntity(world, playerId, ['player']);
      const connection = getEntity(world, player?.player.connectedId, [
        'connected'
      ]);
      if (!player || !connection) {
        world.delete(entity);
        return;
      }

      // dispatchCommand never passes: unhandled commands are refused. A command
      // handed to Scripts replies when they finish.
      if (outcome.kind === 'pass' || outcome.kind === 'started') {
        world.delete(entity);
        return;
      }

      // Create output event for player
      world.create({
        outputEvent: {
          broadcast: false,
          message: label ? `${label}: ${outcome.message}` : outcome.message,
          wsId: connection.connected.wsId
        }
      });

      // Create broadcast output event if needed
      if (outcome.kind === 'done' && outcome.broadcast) {
        world.create({
          outputEvent: {
            broadcast: true,
            exclude: outcome.broadcast.exclude,
            message: outcome.broadcast.message,
            roomId: outcome.broadcast.roomId,
            wsId: '' // Will be resolved by output system
          }
        });
      }

      // Remove command event
      world.delete(entity);
    },
    {
      frequency: 1,
      priority: 30,
      with: ['commandEvent']
    }
  );

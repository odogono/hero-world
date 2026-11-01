import { stepCommand } from '../actions';
import { getEntity } from '../queries/entity';
import { NO_SCRIPTS, type ScriptRunner } from '../scripts/runner';
import { createMuaSystem } from './create-mua-system';

export const createActionSystem = (scripts: ScriptRunner = NO_SCRIPTS) =>
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
        stage,
        target,
        targetId,
        text,
        verb,
        waitTicks
      } = entity.commandEvent;

      // Execute action
      const step = stepCommand(
        {
          direction,
          indirect,
          indirectId: indirectId ?? undefined,
          playerId,
          target,
          targetId: targetId ?? undefined,
          text,
          verb,
          world
        },
        {
          key: `command:${entity.id}`,
          scripts,
          state: { stage, waitTicks }
        }
      );

      // a Script has yet to answer: keep the command for the next tick
      if (step.kind === 'waiting') {
        entity.commandEvent.stage = step.state.stage;
        entity.commandEvent.waitTicks = step.state.waitTicks;
        return;
      }
      const { outcome } = step;

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

      // dispatchCommand never passes: unhandled commands are refused
      if (outcome.kind === 'pass') {
        world.delete(entity);
        return;
      }

      // Create output event for player; a Script may reply with nothing
      if (outcome.message) {
        world.create({
          outputEvent: {
            broadcast: false,
            message: label ? `${label}: ${outcome.message}` : outcome.message,
            room: outcome.kind === 'done' ? outcome.room : undefined,
            wsId: connection.connected.wsId
          }
        });
      }

      // Tell everyone else who saw it
      const broadcasts = outcome.kind === 'done' ? outcome.broadcasts : [];
      for (const { exclude, message, roomId } of broadcasts ?? []) {
        world.create({
          outputEvent: {
            broadcast: true,
            exclude,
            message,
            roomId,
            wsId: '' // Will be resolved by output system
          }
        });
      }

      // Remove command event
      world.delete(entity);
    },
    {
      frequency: 1,
      priority: 20,
      with: ['commandEvent']
    }
  );

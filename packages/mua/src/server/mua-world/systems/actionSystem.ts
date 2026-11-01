import { stepCommand } from '../actions';
import { NO_SCRIPTS, type ScriptRunner } from '../scripts/runner';
import { createMuaSystem } from './create-mua-system';
import { tell } from './output';

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
      if (playerId === undefined) {
        world.delete(entity);
        return;
      }

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

      // dispatchCommand never passes: unhandled commands are refused
      if (outcome.kind === 'pass') {
        world.delete(entity);
        return;
      }

      // Tell the player; a Script may reply with nothing
      if (outcome.message) {
        tell(
          world,
          playerId,
          label ? `${label}: ${outcome.message}` : outcome.message,
          { room: outcome.kind === 'done' ? outcome.room : undefined }
        );
      }

      // Tell everyone else who saw it
      const broadcasts = outcome.kind === 'done' ? outcome.broadcasts : [];
      for (const { exclude, message, to } of broadcasts ?? []) {
        tell(world, to, message, { exclude });
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

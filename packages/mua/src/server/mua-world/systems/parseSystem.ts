import type { EntityId } from 'odgn-ecs/types';

import {
  bindCommand,
  isPendingCommand,
  matchesWords,
  resolvePending,
  type BindResult,
  type PendingCommand
} from '../commands/bind';
import { parseCommand } from '../commands/parser';
import type { CommandParseResult } from '../commands/types';
import { AGAIN_WORDS } from '../commands/verbs';
import { getEntity } from '../queries/entity';
import { findPlayerByConnection } from '../queries/player';
import { getInScope } from '../queries/scope';
import { createMuaSystem } from './create-mua-system';
import { tell } from './output';

type PlayerUpdate = {
  lastCommandAt?: string;
  lastInput?: string;
  lastTargetId?: EntityId;
  pending?: null | PendingCommand;
};

export const parseSystem = createMuaSystem(
  ({ entity, world }) => {
    const { text, wsId } = entity.inputEvent;

    // Any query that loads the player replaces the cached entity and drops
    // unsaved changes, so read a snapshot first and write once at the end.
    const player = findPlayerByConnection(world, wsId);
    const update: PlayerUpdate = {};

    const finish = (message?: string) => {
      if (message !== undefined) {
        // before the player is known, answer the connection itself
        if (player) {
          tell(world, player.id, message);
        } else {
          world.create({ outputEvent: { message, wsId } });
        }
      }
      if (player && Object.keys(update).length > 0) {
        const target = getEntity(world, player.id, ['player'], true);
        if (target) {
          target.player = { ...target.player, ...update };
          // save now: an action loading the player this frame would lose it
          world.flush();
        }
      }
      world.delete(entity);
    };

    if (!player) {
      finish('Player not found. Please login.');
      return;
    }

    // unset optional fields read back from the database as null
    const pending = player.player.pending ?? undefined;
    const lastTargetId = player.player.lastTargetId ?? undefined;
    if (pending !== undefined) {
      update.pending = null;
    }

    let bound: BindResult | undefined;

    // A reply to "which do you mean?" finishes the waiting command
    if (isPendingCommand(pending)) {
      const chosen = resolvePending(pending, text);
      if (chosen !== undefined) {
        bound = bindCommand({
          actorId: player.id,
          command: pending.command,
          lastTargetId,
          resolved: { ...pending.resolved, [pending.slot]: chosen },
          world
        });
      }
    }

    if (!bound) {
      // `again` / `g` repeats the previous command
      const isAgain = AGAIN_WORDS.includes(text.trim().toLowerCase());
      const input = isAgain ? (player.player.lastInput ?? undefined) : text;
      if (input === undefined) {
        finish('There is nothing to repeat.');
        return;
      }

      let parsed: CommandParseResult = parseCommand(input);

      // `bob hello` means "say to bob hello"
      if (!parsed.success) {
        const [first] = input.trim().toLowerCase().split(/\s+/);
        const isListener = getInScope(world, player.id, 'room').some(
          c => c.isPlayer && matchesWords(c, [first!])
        );
        if (isListener) {
          parsed = parseCommand(`say to ${input.trim()}`);
        }
      }

      if (!parsed.success) {
        finish(parsed.error);
        return;
      }

      update.lastInput = input;
      update.lastCommandAt = new Date().toISOString();
      bound = bindCommand({
        actorId: player.id,
        command: parsed.command,
        lastTargetId,
        world
      });
    }

    if (bound.kind === 'error') {
      finish(bound.message);
      return;
    }

    if (bound.kind === 'ambiguous') {
      update.pending = bound.pending;
      finish(bound.message);
      return;
    }

    for (const command of bound.commands) {
      world.create({
        commandEvent: {
          direction: command.direction,
          indirect: command.indirect,
          indirectId: command.indirectId,
          label: command.label,
          playerId: player.id,
          rawInput: command.rawInput,
          target: command.target,
          targetId: command.targetId,
          text: command.text,
          verb: command.verb
        }
      });
    }

    // `it` refers to the last single object acted on
    const [only] = bound.commands;
    if (bound.commands.length === 1 && only?.targetId !== undefined) {
      update.lastTargetId = only.targetId;
    }

    finish();
  },
  {
    frequency: 1,
    priority: 30,
    with: ['inputEvent']
  }
);

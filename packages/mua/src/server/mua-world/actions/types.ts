import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import type { ScriptArg } from '../scripts/runner';

export type ActionContext = {
  direction?: string;
  indirect?: string;
  /** The entity the indirect phrase was bound to */
  indirectId?: EntityId;
  playerId: EntityId;
  target?: string;
  /** The entity the target phrase was bound to */
  targetId?: EntityId;
  text?: string;
  verb: string;
  world: World<MuaComponents>;
};

/** A message for everyone inside an entity (usually a room) */
export type Broadcast = {
  /** Someone inside who should not receive the message */
  exclude?: EntityId;
  message: string;
  to: EntityId;
};

/**
 * Something the scripted things in a place should notice, such as speech or
 * an arrival: `message` with `args` goes to the Scripts of every entity
 * located in `to`, except the actor (see actionSystem).
 */
export type Notice = {
  args: ScriptArg[];
  message: string;
  to: EntityId;
};

/** What the player can see of a room, sent with `look` for clients to show */
export type RoomView = {
  description: string;
  exits: string[];
  /** Things in the room */
  items: string[];
  name: string;
  /** Other players in the room */
  players: string[];
};

/**
 * What a handler did with a command:
 * - `done`    it acted; the world may have changed
 * - `refused` it handled the command by saying no; nothing changed
 * - `pass`    not mine: offer the command to the next handler
 */
export type ActionOutcome =
  | {
      broadcasts?: Broadcast[];
      kind: 'done';
      message: string;
      notices?: Notice[];
      room?: RoomView;
    }
  | { kind: 'pass' }
  | { kind: 'refused'; message: string };

export const done = (
  message: string,
  broadcasts?: Broadcast[]
): ActionOutcome =>
  broadcasts
    ? { broadcasts, kind: 'done', message }
    : { kind: 'done', message };

export const refused = (message: string): ActionOutcome => ({
  kind: 'refused',
  message
});

export const PASS: ActionOutcome = { kind: 'pass' };

/** The text a handler produced, or undefined if it passed */
export const messageOf = (outcome: ActionOutcome) =>
  outcome.kind === 'pass' ? undefined : outcome.message;

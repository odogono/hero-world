import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import type { MuaTalk } from '../talk';

export type ActionContext = {
  direction?: string;
  indirect?: string;
  /** The entity the indirect phrase was bound to */
  indirectId?: EntityId;
  playerId: EntityId;
  /** The World's Script Group; without it, actions run only in TS */
  talk?: MuaTalk;
  target?: string;
  /** The entity the target phrase was bound to */
  targetId?: EntityId;
  text?: string;
  verb: string;
  world: World<MuaComponents>;
};

export type Broadcast = {
  /** Someone in the room who should not receive the message */
  exclude?: EntityId;
  message: string;
  roomId: EntityId;
};

/**
 * What a handler did with a command:
 * - `done`    it acted; the world may have changed
 * - `refused` it handled the command by saying no; nothing changed
 * - `pass`    not mine: offer the command to the next handler
 * - `started` it handed the command to Scripts, and replies when they finish
 */
export type ActionOutcome =
  | { broadcast?: Broadcast; kind: 'done'; message: string }
  | { kind: 'pass' }
  | { kind: 'started' }
  | { kind: 'refused'; message: string };

export const done = (message: string, broadcast?: Broadcast): ActionOutcome =>
  broadcast ? { broadcast, kind: 'done', message } : { kind: 'done', message };

export const refused = (message: string): ActionOutcome => ({
  kind: 'refused',
  message
});

export const PASS: ActionOutcome = { kind: 'pass' };

export const STARTED: ActionOutcome = { kind: 'started' };

/** The text a handler produced, or undefined if it passed or started */
export const messageOf = (outcome: ActionOutcome) =>
  outcome.kind === 'done' || outcome.kind === 'refused'
    ? outcome.message
    : undefined;

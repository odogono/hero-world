import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

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
 */
export type ActionOutcome =
  | { broadcast?: Broadcast; kind: 'done'; message: string }
  | { kind: 'pass' }
  | { kind: 'refused'; message: string };

export const done = (message: string, broadcast?: Broadcast): ActionOutcome =>
  broadcast ? { broadcast, kind: 'done', message } : { kind: 'done', message };

export const refused = (message: string): ActionOutcome => ({
  kind: 'refused',
  message
});

export const PASS: ActionOutcome = { kind: 'pass' };

/** The text a handler produced, or undefined if it passed */
export const messageOf = (outcome: ActionOutcome) =>
  outcome.kind === 'pass' ? undefined : outcome.message;

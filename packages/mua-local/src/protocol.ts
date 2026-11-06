/**
 * The messages between the UI and a Local World's Worker: the Phoenix
 * Channel's (packages/mua_server/docs/protocol.md), so `mua_client` can't
 * tell a Local World from a server's (ADR 0023).
 */
import type { View } from 'mua-world';

/** From the UI */
export type ToWorld =
  /** Starts the World and plays its Character, made with `name` the first time */
  | { name: string; type: 'join' }
  | { ref: number | string; text: string; type: 'command' }
  | { type: 'logout' };

/** From the World */
export type FromWorld =
  | { event: 'output'; lines: string[] }
  | { event: 'prompt'; options: string[]; text: string }
  | { event: 'state'; state: View }
  | { event: 'status'; status: 'connected' | 'limbo' }
  /** The reply to a `join` */
  | { character: number; event: 'joined' }
  /** The reply to a `command`, once its Step has committed */
  | { event: 'reply'; ok: true; ref: number | string }
  | { event: 'reply'; ok: false; reason: string; ref?: number | string }
  /** The World couldn't start or carry on */
  | { event: 'error'; message: string };

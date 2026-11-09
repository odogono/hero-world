import { signal } from '@preact/signals';

import type { Line } from './transcript';

export type Character = { id: number; in_play: boolean; name: string };

export type Session = {
  account: number;
  admin: boolean;
  characters: Character[];
  /** `null` for a session signed in before the server sent it */
  email: string | null;
  socket_token: string;
};

/**
 * - `connecting` before the first join, and while rejoining after a drop
 * - `joined` while this Connection controls the Character
 * - `offline` after a drop, until the socket reconnects
 * - `replaced` when another Connection has taken over
 * - `limbo` after logging out
 */
export type Status = 'connecting' | 'joined' | 'limbo' | 'offline' | 'replaced';

/** `undefined` while the session is being read, `null` when signed out */
export const session = signal<Session | null | undefined>(undefined);
export const status = signal<Status>('connecting');
export const lines = signal<Line[]>([]);
/** Commands this Character has sent, oldest first, for recalling with ↑ */
export const commands = signal<string[]>([]);
/** Commands the Character could type next, from the latest `state` */
export const actions = signal<string[]>([]);

/**
 * A Builder's limits and how many things their Account has placed (#258),
 * from joining, kept current by each place
 */
export type Builder = {
  max_capacity: number;
  max_placed: number;
  placed: number;
};

/** `null` for an Account that doesn't build, or playing offline */
export const builder = signal<Builder | null>(null);

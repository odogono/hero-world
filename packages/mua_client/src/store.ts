import { signal } from '@preact/signals';

import type { Line } from './transcript';

export type Character = { id: number; in_play: boolean; name: string };

export type Session = {
  account: number;
  characters: Character[];
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
/** Commands the Character could type next, from the latest `state` */
export const actions = signal<string[]>([]);

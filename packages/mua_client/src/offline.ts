import { signal } from '@preact/signals';

/**
 * Playing a Local World offline (ADR 0023). Its Character's name is kept in
 * this browser, outside the `mua:` keys that signing out clears, since the
 * Local World is kept here too and plays on after a reload.
 */
const KEY = 'mua-local:name';

/** A Character name, as the World checks it */
export const NAME = /^[A-Za-z][\d 'A-Za-z-]{0,19}$/;

const stored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/**
 * - `undefined` while not playing offline
 * - `null` while choosing a name for the first time
 * - the Character's name while playing
 */
export const offline = signal<string | null | undefined>(undefined);

/** Starts playing offline, as the Character from last time if there was one */
export const playOffline = () => {
  offline.value = stored();
};

/** Chooses the local Character's name, checked as the World checks it */
export const chooseName = async (name: string) => {
  if (!NAME.test(name)) {
    return { error: 'invalid_name', ok: false } as const;
  }
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // storage blocked: the name lasts this visit
  }
  offline.value = name;
  return { ok: true } as const;
};

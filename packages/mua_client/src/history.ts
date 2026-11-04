import type { Line } from './transcript';

/** The most lines kept across a reload, so storage stays small */
const LIMIT = 500;
/** The most commands kept for recalling with ↑ */
const COMMAND_LIMIT = 100;
const PREFIX = 'mua:';

const key = (kind: 'commands' | 'transcript', character: number) =>
  `${PREFIX}${kind}:${character}`;

const read = (name: string): unknown[] => {
  try {
    const raw = localStorage.getItem(name);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (name: string, value: unknown[]) => {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // storage full or blocked: this just won't survive a reload
  }
};

const ours = () => {
  try {
    return Object.keys(localStorage).filter(name => name.startsWith(PREFIX));
  } catch {
    return [];
  }
};

/** The transcript last saved for this Character, oldest first */
export const loadHistory = (character: number) =>
  read(key('transcript', character)) as Line[];

export const saveHistory = (character: number, lines: Line[]) =>
  write(key('transcript', character), lines.slice(-LIMIT));

/** The commands last saved for this Character, oldest first */
export const loadCommands = (character: number) =>
  read(key('commands', character)).filter(
    (command): command is string => typeof command === 'string'
  );

export const saveCommands = (character: number, commands: string[]) =>
  write(key('commands', character), commands.slice(-COMMAND_LIMIT));

/** Forgets what was saved for any other Character, such as a deleted one */
export const keepOnly = (character: number) => {
  for (const name of ours()) {
    if (!name.endsWith(`:${character}`)) {
      localStorage.removeItem(name);
    }
  }
};

/** Forgets everything saved, so the next person on this browser sees none */
export const clearHistory = () => {
  for (const name of ours()) {
    localStorage.removeItem(name);
  }
};

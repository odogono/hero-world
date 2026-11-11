/**
 * The transcript: every line the player sees, as plain data. Commands carry
 * whether the server has confirmed them, since a command sent just before a
 * Connection drops may or may not have run, and is never sent again
 * (ADR 0013).
 */
export type CommandState = 'pending' | 'confirmed' | 'unconfirmed';

export type Line =
  | { id: number; kind: 'command'; state: CommandState; text: string }
  | { id: number; kind: 'error'; text: string }
  /** output may have been missed: after a dropped Connection, or a reload */
  | { id: number; kind: 'gap'; reason?: 'drop' | 'reload' }
  /** `suggestions`: Commands the line offers, to send with one click */
  | { id: number; kind: 'output'; suggestions?: string[]; text: string }
  | { id: number; kind: 'prompt'; options: string[]; text: string }
  | { id: number; kind: 'status'; text: string };

export type NewLine = Line extends infer L
  ? L extends Line
    ? Omit<L, 'id'>
    : never
  : never;

let nextId = 1;

export const append = (lines: Line[], line: NewLine): Line[] => [
  ...lines,
  { ...line, id: nextId++ } as Line
];

/** A command sent to the server, waiting for its Step to commit */
export const sent = (lines: Line[], text: string): [Line[], number] => {
  const id = nextId;
  return [append(lines, { kind: 'command', state: 'pending', text }), id];
};

const setState = (lines: Line[], id: number, state: CommandState) =>
  lines.map(line =>
    line.kind === 'command' && line.id === id ? { ...line, state } : line
  );

/** The server committed the command's Step */
export const confirmed = (lines: Line[], id: number) =>
  setState(lines, id, 'confirmed');

/** The command may or may not have run: mark it, and never resend it */
export const unconfirmed = (lines: Line[], id: number) =>
  setState(lines, id, 'unconfirmed');

/** The Connection dropped: every command still waiting is now uncertain */
export const connectionLost = (lines: Line[]) =>
  lines.map(line =>
    line.kind === 'command' && line.state === 'pending'
      ? { ...line, state: 'unconfirmed' as const }
      : line
  );

/** Joined again after a drop: mark the gap, as output may have been missed */
export const rejoined = (lines: Line[]) =>
  lines.length === 0 ? lines : append(lines, { kind: 'gap', reason: 'drop' });

/**
 * A transcript read back after a reload: commands that were waiting may or
 * may not have run, and output may have been missed while the page was gone.
 * New lines are numbered after the restored ones.
 */
export const restored = (saved: Line[]): Line[] => {
  for (const line of saved) {
    nextId = Math.max(nextId, line.id + 1);
  }
  const lines = connectionLost(saved);
  // reloading again with nothing new since keeps the one marker
  return lines.length === 0 || lines.at(-1)?.kind === 'gap'
    ? lines
    : append(lines, { kind: 'gap', reason: 'reload' });
};

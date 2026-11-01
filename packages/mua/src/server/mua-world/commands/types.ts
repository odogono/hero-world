import type { Scope } from '../queries/scope';

export type ParsedCommand = {
  direction?: string;
  /** The second noun phrase, after a preposition: `bag` in `put lamp in bag` */
  indirect?: string;
  /** Where to look for the indirect object */
  indirectScope?: Scope;
  rawInput: string;
  /** The direct object's noun phrase, articles removed */
  target?: string;
  /** Where to look for the direct object */
  targetScope?: Scope;
  /** Free text, case preserved: what was said in `say Hello there` */
  text?: string;
  /** The handler (action id) of the matched verb form */
  verb: string;
};

export type CommandParseResult =
  { command: ParsedCommand; success: true } | { error: string; success: false };

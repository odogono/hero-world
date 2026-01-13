export type ParsedCommand = {
  direction?: string;
  rawInput: string;
  target?: string;
  verb: string;
};

export type CommandParseResult =
  | { command: ParsedCommand; success: true; }
  | { error: string; success: false; };

export type ParsedCommand = {
  verb: string;
  target?: string;
  direction?: string;
  rawInput: string;
};

export type CommandParseResult =
  | { success: true; command: ParsedCommand }
  | { success: false; error: string };

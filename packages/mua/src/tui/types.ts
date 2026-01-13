export type GameMessage = {
  content: string;
  id: string;
  timestamp: string;
  type: 'system' | 'game' | 'error' | 'success';
};

export type PlayerState = {
  health?: number;
  level?: number;
  location: string;
};

export type RoomData = {
  description: string;
  exits: string[];
  items: string[];
  name: string;
  npcs: string[];
};

export type CommandHistory = {
  addCommand: (cmd: string) => void;
  currentIndex: number;
  getNext: () => string | null;
  getPrevious: () => string | null;
  history: string[];
  reset: () => void;
};

export type DebugCommand = {
  command: string;
  response: string;
  timestamp: string;
};

export type DebugState = {
  clear: () => void;
  isRecording: boolean;
  recordedCommands: DebugCommand[];
  replay: (sendFn: (cmd: string) => void) => Promise<void>;
  startRecording: () => void;
  stopRecording: () => void;
};

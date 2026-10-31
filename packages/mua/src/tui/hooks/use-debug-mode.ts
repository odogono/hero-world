import { useCallback, useState } from 'react';

import { type DebugCommand, type DebugState } from '../types';

export const useDebugMode = (): DebugState => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCommands, setRecordedCommands] = useState<DebugCommand[]>([]);
  const [lastCommand, setLastCommand] = useState<string>('');

  /**
   * Start recording commands
   */
  const startRecording = useCallback(() => {
    setIsRecording(true);
    setRecordedCommands([]); // Clear previous recording
  }, []);

  /**
   * Stop recording commands
   */
  const stopRecording = useCallback(() => {
    setIsRecording(false);
  }, []);

  /**
   * Replay recorded commands
   */
  const replay = useCallback(
    async (sendFn: (cmd: string) => void) => {
      for (const recorded of recordedCommands) {
        sendFn(recorded.command);
        // Wait 1 second between commands
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    },
    [recordedCommands]
  );

  /**
   * Clear recorded commands
   */
  const clear = useCallback(() => {
    setRecordedCommands([]);
  }, []);

  /**
   * Record a command and its response
   */
  const recordCommand = useCallback(
    (command: string, response: string) => {
      if (!isRecording) {
        return;
      }

      const debugCommand: DebugCommand = {
        command,
        response,
        timestamp: new Date().toISOString()
      };

      setRecordedCommands(prev => [...prev, debugCommand]);
      setLastCommand(command);
    },
    [isRecording]
  );

  return {
    clear,
    isRecording,
    recordedCommands,
    replay,
    startRecording,
    stopRecording
  };
};

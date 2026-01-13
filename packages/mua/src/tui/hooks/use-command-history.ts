import { useCallback, useState } from 'react';

import { type CommandHistory } from '../types';

const MAX_HISTORY = 50;

export const useCommandHistory = (): CommandHistory => {
  const [history, setHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  /**
   * Add a command to history
   * Skip if it's the same as the last command
   */
  const addCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) {return;}

    setHistory(prev => {
      // Don't add duplicate consecutive commands
      if (prev.length > 0 && prev.at(-1) === trimmed) {
        return prev;
      }

      const updated = [...prev, trimmed];
      // Keep only last MAX_HISTORY commands
      return updated.slice(-MAX_HISTORY);
    });

    // Reset index to end (ready for next command)
    setCurrentIndex(-1);
  }, []);

  /**
   * Get previous command (up arrow)
   */
  const getPrevious = useCallback((): string | null => {
    if (history.length === 0) {return null;}

    setCurrentIndex(prev => {
      // If at end (-1), start from last item
      if (prev === -1) {
        return history.length - 1;
      }
      // If at beginning, stay there
      if (prev === 0) {
        return 0;
      }
      // Otherwise, move back
      return prev - 1;
    });

    // Return the command at the new index
    const newIndex = currentIndex === -1 ? history.length - 1 : Math.max(0, currentIndex - 1);
    return history[newIndex] || null;
  }, [history, currentIndex]);

  /**
   * Get next command (down arrow)
   */
  const getNext = useCallback((): string | null => {
    if (history.length === 0) {return null;}
    if (currentIndex === -1) {return null;}

    setCurrentIndex(prev => {
      // If at end, stay at end
      if (prev >= history.length - 1) {
        return -1; // Reset to end
      }
      // Otherwise, move forward
      return prev + 1;
    });

    // Return the command at the new index, or null if we're at the end
    const newIndex = currentIndex + 1;
    if (newIndex >= history.length) {
      return null; // Return empty to clear input
    }
    return history[newIndex] || null;
  }, [history, currentIndex]);

  /**
   * Reset index to end (called when user types)
   */
  const reset = useCallback(() => {
    setCurrentIndex(-1);
  }, []);

  return {
    addCommand,
    currentIndex,
    getNext,
    getPrevious,
    history,
    reset
  };
};

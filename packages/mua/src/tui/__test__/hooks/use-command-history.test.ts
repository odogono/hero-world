import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { useCommandHistory } from '../../hooks/use-command-history';

describe('useCommandHistory', () => {
  it('initializes with empty history', () => {
    const { result } = renderHook(() => useCommandHistory());

    expect(result.current.history).toEqual([]);
    expect(result.current.currentIndex).toBe(-1);
  });

  it('adds commands to history', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('look');
    });

    expect(result.current.history).toEqual(['look']);
  });

  it('skips empty commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('');
      result.current.addCommand('   ');
    });

    expect(result.current.history).toEqual([]);
  });

  it('trims whitespace from commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('  look  ');
    });

    expect(result.current.history).toEqual(['look']);
  });

  it('skips duplicate consecutive commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('look');
      result.current.addCommand('look');
      result.current.addCommand('look');
    });

    expect(result.current.history).toEqual(['look']);
  });

  it('allows same command if not consecutive', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('look');
      result.current.addCommand('go north');
      result.current.addCommand('look');
    });

    expect(result.current.history).toEqual(['look', 'go north', 'look']);
  });

  it('limits history to MAX_HISTORY (50)', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      for (let i = 0; i < 60; i++) {
        result.current.addCommand(`cmd${i}`);
      }
    });

    expect(result.current.history.length).toBe(50);
    // First 10 should be removed, so first item should be 'cmd10'
    expect(result.current.history[0]).toBe('cmd10');
    expect(result.current.history[49]).toBe('cmd59');
  });

  it('navigates history with getPrevious', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('cmd1');
      result.current.addCommand('cmd2');
      result.current.addCommand('cmd3');
    });

    let cmd;

    // First getPrevious should return last command
    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBe('cmd3');

    // Second should return second-to-last
    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBe('cmd2');

    // Third should return first
    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBe('cmd1');
  });

  it('stops at beginning with getPrevious', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('cmd1');
    });

    // Navigate to first command
    act(() => {
      result.current.getPrevious();
    });

    // Try to go before first
    act(() => {
      result.current.getPrevious();
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it('navigates forward with getNext', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('cmd1');
      result.current.addCommand('cmd2');
      result.current.addCommand('cmd3');
    });

    let cmd;

    // Go back twice
    act(() => {
      result.current.getPrevious(); // cmd3
      result.current.getPrevious(); // cmd2
    });

    // Go forward once
    act(() => {
      cmd = result.current.getNext();
    });
    expect(cmd).toBe('cmd3');
  });

  it('returns null when getNext reaches end', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('cmd1');
    });

    let cmd;
    act(() => {
      cmd = result.current.getNext(); // Already at end
    });
    expect(cmd).toBeNull();
  });

  it('returns null when getPrevious called on empty history', () => {
    const { result } = renderHook(() => useCommandHistory());

    let cmd;
    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBeNull();
  });

  it('returns null when getNext called on empty history', () => {
    const { result } = renderHook(() => useCommandHistory());

    let cmd;
    act(() => {
      cmd = result.current.getNext();
    });
    expect(cmd).toBeNull();
  });

  it('resets index to end', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('look');
      result.current.getPrevious(); // Move index
      result.current.reset();
    });

    expect(result.current.currentIndex).toBe(-1);
  });

  it('resets index after adding command', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('cmd1');
    });

    act(() => {
      result.current.getPrevious(); // Set index to 0
    });

    expect(result.current.currentIndex).toBe(0);

    act(() => {
      result.current.addCommand('cmd2'); // Should reset index to -1
    });

    expect(result.current.currentIndex).toBe(-1);
  });

  it('handles complete navigation cycle', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand('cmd1');
      result.current.addCommand('cmd2');
      result.current.addCommand('cmd3');
    });

    let cmd;

    // Navigate back through all commands
    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBe('cmd3');

    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBe('cmd2');

    act(() => {
      cmd = result.current.getPrevious();
    });
    expect(cmd).toBe('cmd1');

    // Navigate forward
    act(() => {
      cmd = result.current.getNext();
    });
    expect(cmd).toBe('cmd2');

    act(() => {
      cmd = result.current.getNext();
    });
    expect(cmd).toBe('cmd3');

    // At end now
    act(() => {
      cmd = result.current.getNext();
    });
    expect(cmd).toBeNull();
    expect(result.current.currentIndex).toBe(-1);
  });
});

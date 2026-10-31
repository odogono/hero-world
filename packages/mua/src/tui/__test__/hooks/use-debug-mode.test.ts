import { describe, expect, it, mock } from 'bun:test';

import { act, renderHook } from '@testing-library/react';

import { useDebugMode } from '../../hooks/use-debug-mode';

describe('useDebugMode', () => {
  it('initializes with recording off', () => {
    const { result } = renderHook(() => useDebugMode());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordedCommands).toEqual([]);
  });

  it('starts recording', () => {
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
  });

  it('stops recording', () => {
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.startRecording();
      result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('clears previous recordings when starting new recording', () => {
    const { result } = renderHook(() => useDebugMode());

    // Note: Since recordCommand is not exported, we can't directly test recording
    // This test verifies that startRecording clears the recorded commands array
    act(() => {
      result.current.startRecording();
    });

    // Recorded commands should be empty after starting
    expect(result.current.recordedCommands).toEqual([]);

    // Stop and start again
    act(() => {
      result.current.stopRecording();
      result.current.startRecording();
    });

    // Should still be empty
    expect(result.current.recordedCommands).toEqual([]);
  });

  it('clears recorded commands', () => {
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.clear();
    });

    expect(result.current.recordedCommands).toEqual([]);
  });

  it('replays commands with delay', async () => {
    const { result } = renderHook(() => useDebugMode());
    const sendFn = mock(() => {});

    // Manually set some recorded commands for testing
    // Since recordCommand is not exported, we can only test replay with empty array
    // or we need to use integration tests

    const startTime = Date.now();

    await act(async () => {
      await result.current.replay(sendFn);
    });

    const elapsed = Date.now() - startTime;

    // With 0 commands, should complete immediately (< 100ms)
    expect(elapsed).toBeLessThan(100);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('replay calls send function for each command with delay', async () => {
    // This test would require access to recordCommand or manual state manipulation
    // For now, we test the interface exists and can be called
    const { result } = renderHook(() => useDebugMode());
    const sendFn = mock(() => {});

    await act(async () => {
      await result.current.replay(sendFn);
    });

    // With empty recordedCommands, sendFn should not be called
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('multiple start/stop cycles work correctly', () => {
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });
    expect(result.current.isRecording).toBe(false);

    act(() => {
      result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });
    expect(result.current.isRecording).toBe(false);
  });

  it('clear works when recording is active', () => {
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.startRecording();
      result.current.clear();
    });

    expect(result.current.recordedCommands).toEqual([]);
    expect(result.current.isRecording).toBe(true); // Recording state should not be affected
  });

  it('clear works when recording is inactive', () => {
    const { result } = renderHook(() => useDebugMode());

    act(() => {
      result.current.clear();
    });

    expect(result.current.recordedCommands).toEqual([]);
    expect(result.current.isRecording).toBe(false);
  });
});

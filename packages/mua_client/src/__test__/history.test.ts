import { afterEach, describe, expect, test } from 'bun:test';

import {
  clearHistory,
  keepOnly,
  loadCommands,
  loadHistory,
  loadPictureMode,
  saveCommands,
  saveHistory,
  savePictureMode
} from '../history';

afterEach(() => localStorage.clear());

describe('the saved history', () => {
  test('keeps a transcript and commands per Character', () => {
    saveHistory(1, [{ id: 1, kind: 'output', text: 'Hall' }]);
    saveCommands(1, ['look']);
    expect(loadHistory(1)).toEqual([{ id: 1, kind: 'output', text: 'Hall' }]);
    expect(loadCommands(1)).toEqual(['look']);
    expect(loadHistory(2)).toEqual([]);
  });

  test('keeps only the latest 500 lines', () => {
    const lines = Array.from({ length: 600 }, (_, id) => ({
      id,
      kind: 'output' as const,
      text: `${id}`
    }));
    saveHistory(1, lines);
    expect(loadHistory(1)).toHaveLength(500);
    expect(loadHistory(1)[0]?.id).toBe(100);
  });

  test('ignores what it cannot read', () => {
    localStorage.setItem('mua:transcript:1', '{not json');
    expect(loadHistory(1)).toEqual([]);
  });

  test('forgets other Characters, and everything on sign out', () => {
    saveHistory(1, [{ id: 1, kind: 'output', text: 'a' }]);
    saveHistory(12, [{ id: 1, kind: 'output', text: 'b' }]);
    localStorage.setItem('theme', 'dark');
    keepOnly(12);
    expect(loadHistory(1)).toEqual([]);
    expect(loadHistory(12)).toHaveLength(1);
    clearHistory();
    expect(loadHistory(12)).toEqual([]);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  test('keeps how Pictures are shown for every Character, past clearing the history', () => {
    expect(loadPictureMode()).toBe('shown');
    savePictureMode('off');
    clearHistory();
    keepOnly(3);
    expect(loadPictureMode()).toBe('off');
  });
});

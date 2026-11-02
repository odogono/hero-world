import { describe, expect, test } from 'bun:test';

import {
  append,
  confirmed,
  connectionLost,
  rejoined,
  sent,
  type Line
} from '../transcript';

const kinds = (lines: Line[]) => lines.map(line => line.kind);
const commandStates = (lines: Line[]) =>
  lines.flatMap(line => (line.kind === 'command' ? [line.state] : []));

describe('the transcript', () => {
  test('a command waits for its Step to commit', () => {
    const [lines, ref] = sent([], 'look');
    expect(commandStates(lines)).toEqual(['pending']);
    expect(commandStates(confirmed(lines, ref))).toEqual(['confirmed']);
  });

  test('a drop leaves waiting commands unconfirmed, and confirmed ones alone', () => {
    const [taken, first] = sent([], 'take coin');
    const [lines] = sent(confirmed(taken, first), 'north');

    expect(commandStates(connectionLost(lines))).toEqual([
      'confirmed',
      'unconfirmed'
    ]);
  });

  test('rejoining marks a gap, but not before anything was seen', () => {
    expect(rejoined([])).toEqual([]);

    const lines = append([], { kind: 'output', text: 'Plaza' });
    expect(kinds(rejoined(lines))).toEqual(['output', 'gap']);
  });
});

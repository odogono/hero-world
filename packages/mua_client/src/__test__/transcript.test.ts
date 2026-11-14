import { describe, expect, test } from 'bun:test';

import {
  append,
  confirmed,
  connectionLost,
  pictureOpened,
  pictureShown,
  rejoined,
  restored,
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

describe('a transcript restored after a reload', () => {
  test('marks waiting commands unconfirmed and adds a gap', () => {
    const [lines] = sent(append([], { kind: 'output', text: 'Hall' }), 'north');
    expect(kinds(restored(lines))).toEqual(['output', 'command', 'gap']);
    expect(commandStates(restored(lines))).toEqual(['unconfirmed']);
  });

  test('adds no second marker when nothing came after the last', () => {
    const once = restored(append([], { kind: 'output', text: 'Hall' }));
    expect(kinds(restored(once))).toEqual(['output', 'gap']);
  });

  test('stays empty when nothing was saved', () => {
    expect(restored([])).toEqual([]);
  });

  test('numbers new lines after the restored ones', () => {
    const saved: Line[] = [{ id: 10_000, kind: 'output', text: 'Hall' }];
    const next = append(restored(saved), { kind: 'output', text: 'Yard' });
    expect(next.at(-1)!.id).toBeGreaterThan(10_000);
  });

  test('forgets which Pictures the reader showed or folded, so only the newest shows (ADR 0027)', () => {
    const picture = { alt: 'A hall.', name: 'Hall', url: '/pictures/hall.png' };
    let saved = append([], { ...picture, kind: 'picture' });
    saved = append(saved, { ...picture, kind: 'picture' });
    const [older, newest] = saved;
    saved = pictureOpened(saved, older!.id, true);
    saved = pictureOpened(saved, newest!.id, false);

    const pictures = restored(saved).filter(line => line.kind === 'picture');
    expect(
      pictures.map(line => pictureShown(line, line.id === newest!.id, 'shown'))
    ).toEqual([false, true]);
    expect(
      pictures.map(line =>
        pictureShown(line, line.id === newest!.id, 'collapsed')
      )
    ).toEqual([false, false]);
  });
});

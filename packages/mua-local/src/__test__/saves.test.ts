// Saving a Local World as a file, and loading one in its place (#219), with
// Bun's sqlite on disk in place of the Worker's OPFS.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { DatabaseType, isSqliteFile } from 'odgn-ecs/db';

import { worldFiles } from '../../scripts/files';
import { EDL_PATH } from '../files';
import { createLocalHost } from '../local';
import type { FromWorld } from '../protocol';

const FILES = worldFiles();

const host = (files = FILES) => {
  const path = join(mkdtempSync(join(tmpdir(), 'mua-saves-')), 'world.db');
  const sent: FromWorld[] = [];
  const local = createLocalHost({
    clock: () => 0,
    database: { path, type: DatabaseType.BUN },
    files,
    send: message => sent.push(message)
  });
  return { local, sent };
};

const last = <E extends FromWorld['event']>(sent: FromWorld[], event: E) =>
  sent.filter(m => m.event === event).at(-1) as
    Extract<FromWorld, { event: E }> | undefined;

/** Joins as Ada and walks north, so the World differs from a new one */
const played = async () => {
  const h = host();
  await h.local.receive({ name: 'Ada', type: 'join' });
  await h.local.receive({ ref: 1, text: 'north', type: 'command' });
  await h.local.receive({ type: 'save' });
  return last(h.sent, 'saved')!.bytes;
};

const room = (sent: FromWorld[]) => last(sent, 'state')?.state.room.name;

describe('saving and loading a Local World', () => {
  test('saves the World as an SQLite file', async () => {
    expect(isSqliteFile(await played())).toBe(true);
  });

  test('loads a save in place of the World, which plays on from it', async () => {
    const save = await played();
    const other = host();
    await other.local.receive({ name: 'Bob', type: 'join' });
    expect(room(other.sent)).toBe('West of house');

    await other.local.receive({ bytes: save, type: 'load' });
    expect(last(other.sent, 'loaded')).toEqual({ event: 'loaded' });

    // the save's Character, where it was
    await other.local.receive({ name: 'ignored', type: 'join' });
    expect(room(other.sent)).toBe('North of house');
    expect(
      other.sent.flatMap(m => (m.event === 'output' ? m.lines : []))
    ).not.toContain(
      "Welcome, ignored! Type 'look' to begin, or 'help' for the commands."
    );
  });

  test('refuses a file that is not a database, and plays on', async () => {
    const h = host();
    await h.local.receive({ name: 'Bob', type: 'join' });
    await h.local.receive({
      bytes: new TextEncoder().encode('not a world'),
      type: 'load'
    });
    expect(last(h.sent, 'loadFailed')).toEqual({
      event: 'loadFailed',
      message: 'That file is not a saved World'
    });
    await h.local.receive({ ref: 1, text: 'north', type: 'command' });
    expect(room(h.sent)).toBe('North of house');
  });

  test('refuses a database that is not a World, and puts the World back', async () => {
    const h = host();
    await h.local.receive({ name: 'Bob', type: 'join' });
    await h.local.receive({ ref: 1, text: 'north', type: 'command' });

    const other = new Database(':memory:');
    other.exec('CREATE TABLE notes (text TEXT)');
    const bytes = new Uint8Array(other.serialize());
    other.close();

    await h.local.receive({ bytes, type: 'load' });
    expect(last(h.sent, 'loadFailed')?.message).toBe(
      'That file is not a saved World'
    );
    await h.local.receive({ name: 'Bob', type: 'join' });
    expect(room(h.sent)).toBe('North of house');
  });

  test('migrates a save from an older World before it plays', async () => {
    const save = await played();
    const shed = `${FILES[EDL_PATH]!}
entity shed : room {
  described { name: "Shed" description: "A garden shed." }
}
`;
    const newer = host({ ...FILES, [EDL_PATH]: shed });
    await newer.local.receive({ bytes: save, type: 'load' });
    expect(last(newer.sent, 'loaded')).toBeDefined();
    expect(await newer.local.world()!.world.named('shed')).toBeNumber();
    await newer.local.receive({ name: 'Ada', type: 'join' });
    expect(room(newer.sent)).toBe('North of house');
  });
});

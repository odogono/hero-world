// A Local World over the main World's bundled files, with Bun's sqlite in
// place of the Worker's OPFS.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';

import { worldFiles, worldPictures } from '../../scripts/files';
import { EDL_PATH } from '../files';
import { openLocalWorld } from '../local';
import type { FromWorld } from '../protocol';

const FILES = worldFiles();

const open = async (path = ':memory:', files = FILES) => {
  const sent: FromWorld[] = [];
  const local = await openLocalWorld({
    clock: () => 0,
    database: { path, type: DatabaseType.BUN },
    files,
    pictures: worldPictures(),
    send: message => sent.push(message)
  });
  return { local, sent };
};

const events = (sent: FromWorld[], event: FromWorld['event']) =>
  sent.filter(m => m.event === event);

const output = (sent: FromWorld[]) =>
  events(sent, 'output').flatMap(m => (m.event === 'output' ? m.lines : []));

describe('a Local World', () => {
  test('bundles the main World and mua-scripts', () => {
    expect(Object.keys(FILES)).toContain(EDL_PATH);
    expect(Object.keys(FILES)).toContain('/mua-scripts/edl/base.edl');
    expect(Object.keys(FILES)).toContain('/world/scripts/town/room.talk');
  });

  test('joins its Character, welcomed, connected and shown its room', async () => {
    const { local, sent } = await open();
    await local.receive({ name: 'Ada', type: 'join' });
    expect(sent[0]).toMatchObject({ event: 'joined' });
    expect(events(sent, 'status')).toEqual([
      { event: 'status', status: 'connected' }
    ]);
    expect(output(sent)).toEqual([
      "Welcome, Ada! Type 'look' to begin, or 'help' for the commands."
    ]);
    const [state] = events(sent, 'state');
    expect(state).toMatchObject({
      state: {
        inventory: [],
        room: {
          exits: ['north', 'south', 'east', 'west'],
          items: ['Sea', 'Noticeboard', 'Crate'],
          name: 'Harbour Steps'
        }
      }
    });
    expect(state?.event === 'state' && state.state.actions).toContain('north');
  });

  test('replies to a command once committed, with its output and a fresh state', async () => {
    const { local, sent } = await open();
    await local.receive({ name: 'Ada', type: 'join' });
    sent.length = 0;
    await local.receive({ ref: 1, text: 'north', type: 'command' });
    expect(output(sent).join('\n')).toContain('The Square');
    expect(events(sent, 'reply')).toEqual([
      { event: 'reply', ok: true, ref: 1 }
    ]);
    expect(events(sent, 'state')[0]).toMatchObject({
      state: { room: { name: 'The Square' } }
    });
  });

  test("shows a place's Picture just before its description (ADR 0027)", async () => {
    const { local, sent } = await open();
    await local.receive({ name: 'Ada', type: 'join' });
    sent.length = 0;
    await local.receive({ ref: 1, text: 'look', type: 'command' });
    const told = sent.filter(
      m => m.event === 'picture' || m.event === 'output'
    );
    expect(told[0]).toEqual({
      alt: expect.stringMatching(/^Worn granite steps/) as never,
      event: 'picture',
      name: 'Harbour Steps',
      url: expect.stringMatching(
        /^\/pictures\/harbour_steps\.png\?vsn=[\da-f]{12}$/
      ) as never
    });
    expect(told[1]).toMatchObject({ event: 'output' });
  });

  test('refuses a command too long, or before joining', async () => {
    const { local, sent } = await open();
    await local.receive({ ref: 'a', text: 'look', type: 'command' });
    await local.receive({ name: 'Ada', type: 'join' });
    await local.receive({ ref: 'b', text: 'x'.repeat(501), type: 'command' });
    expect(events(sent, 'reply')).toEqual([
      { event: 'reply', ok: false, reason: 'not_joined', ref: 'a' },
      { event: 'reply', ok: false, reason: 'command too long', ref: 'b' }
    ]);
  });

  test('logs out to Limbo, and a later join returns to the room it left', async () => {
    const { local, sent } = await open();
    await local.receive({ name: 'Ada', type: 'join' });
    await local.receive({ ref: 1, text: 'north', type: 'command' });
    await local.receive({ type: 'logout' });
    expect(events(sent, 'status').at(-1)).toEqual({
      event: 'status',
      status: 'limbo'
    });
    sent.length = 0;
    await local.receive({ name: 'ignored', type: 'join' });
    expect(events(sent, 'state')[0]).toMatchObject({
      state: { room: { name: 'The Square' } }
    });
  });

  test('keeps its Character and World in its database, so a reload plays on', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mua-local-')), 'world.db');
    const first = await open(path);
    await first.local.receive({ name: 'Ada', type: 'join' });
    await first.local.receive({ ref: 1, text: 'north', type: 'command' });
    first.local.world.store.db.close();

    const second = await open(path);
    await second.local.receive({ name: 'someone else', type: 'join' });
    const joined = events(second.sent, 'joined')[0];
    expect(joined).toEqual(events(first.sent, 'joined')[0]!);
    expect(events(second.sent, 'state')[0]).toMatchObject({
      state: { room: { name: 'The Square' } }
    });
  });

  test('migrates a World built from an older EDL before it plays', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mua-local-')), 'world.db');
    const first = await open(path);
    await first.local.receive({ name: 'Ada', type: 'join' });
    first.local.world.store.db.close();

    const edl = `${FILES[EDL_PATH]!}
entity boathouse : room {
  described { name: "Boathouse" description: "A boathouse." }
}
`;
    const second = await open(path, { ...FILES, [EDL_PATH]: edl });
    expect(await second.local.world.named('boathouse')).toBeNumber();
  });
});

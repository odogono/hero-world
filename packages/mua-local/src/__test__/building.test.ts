// Building in a Local World (#292): the local Account builds from the
// start, through the Channel's building messages.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get, remove } from 'odgn-ecs/store';

import { worldFiles } from '../../scripts/files';
import { openLocalWorld } from '../local';
import type { FromWorld } from '../protocol';

const FILES = worldFiles();

const SATCHEL = {
  container: { capacity: 5, is_closed: true },
  described: { description: 'A leather satchel.', name: 'Satchel' },
  item: {}
};

const open = async (path = ':memory:') => {
  const sent: FromWorld[] = [];
  const local = await openLocalWorld({
    clock: () => 0,
    database: { path, type: DatabaseType.BUN },
    files: FILES,
    send: message => sent.push(message)
  });
  return { local, sent };
};

const joined = async (path?: string) => {
  const opened = await open(path);
  await opened.local.receive({ name: 'Ada', type: 'join' });
  return opened;
};

type Event = FromWorld['event'];
type Of<E extends Event> = Extract<FromWorld, { event: E }>;

const events = <E extends Event>(sent: FromWorld[], event: E) =>
  sent.filter((m): m is Of<E> => m.event === event);

const lastReply = (sent: FromWorld[]) => events(sent, 'reply').at(-1);

const output = (sent: FromWorld[]) =>
  events(sent, 'output').flatMap(m => m.lines);

describe('building in a Local World (#292)', () => {
  test('the local Account builds from the start, with the default limits', async () => {
    const { sent } = await joined();
    expect(events(sent, 'joined')[0]?.builder).toEqual({
      max_capacity: 20,
      max_placed: 50,
      placed: 0
    });
  });

  test('places a satchel, offered a way back to it', async () => {
    const { local, sent } = await joined();
    sent.length = 0;
    await local.receive({ composition: SATCHEL, ref: 'p1', type: 'place' });
    expect(lastReply(sent)).toEqual({
      eid: expect.any(Number),
      event: 'reply',
      max_placed: 50,
      ok: true,
      placed: 1,
      ref: 'p1'
    });
    expect(events(sent, 'output')).toContainEqual({
      event: 'output',
      lines: ['You make the satchel.'],
      suggestions: ['edit the satchel']
    });
    expect(events(sent, 'state').at(-1)?.state.room.items).toContain('Satchel');
  });

  test('edits, stores and destroys the satchel through Worker messages', async () => {
    const { local, sent } = await joined();
    await local.receive({ composition: SATCHEL, ref: 1, type: 'place' });
    const placed = lastReply(sent) as { eid: number };
    const satchel = placed.eid;

    // the `edit` Verb opens it in the Composer
    sent.length = 0;
    await local.receive({ ref: 2, text: 'edit satchel', type: 'command' });
    const [compose] = events(sent, 'compose');
    expect(compose?.eid).toBe(satchel);
    expect(compose?.composition.described).toEqual(SATCHEL.described);

    sent.length = 0;
    await local.receive({
      eid: satchel,
      patch: { put: { described: { description: 'A battered satchel.' } } },
      ref: 3,
      type: 'edit'
    });
    expect(lastReply(sent)).toEqual({
      eid: satchel,
      event: 'reply',
      ok: true,
      ref: 3
    });
    expect(output(sent)).toContain('You reshape the satchel.');
    // saving closes it, and the client hears it as the Channel's do
    expect(events(sent, 'closed')).toEqual([{ eid: satchel, event: 'closed' }]);
    expect(get(local.world.store, satchel, 'described')?.description).toBe(
      'A battered satchel.'
    );

    await local.receive({ ref: 4, text: 'edit satchel', type: 'command' });
    sent.length = 0;
    await local.receive({ eid: satchel, ref: 5, type: 'store' });
    expect(lastReply(sent)).toEqual({
      eid: satchel,
      event: 'reply',
      max_placed: 50,
      ok: true,
      placed: 1,
      ref: 5
    });
    expect(output(sent)).toContain('You put away the satchel.');
    expect(events(sent, 'state').at(-1)?.state.room.items).not.toContain(
      'Satchel'
    );

    await local.receive({ ref: 6, text: 'unstore satchel', type: 'command' });
    await local.receive({ ref: 7, text: 'edit satchel', type: 'command' });
    sent.length = 0;
    await local.receive({ eid: satchel, ref: 8, type: 'destroy' });
    expect(lastReply(sent)).toMatchObject({ ok: true, placed: 0, ref: 8 });
    expect(output(sent)).toContain('You unmake the satchel.');
  });

  test('stop_editing closes it without a `closed`, and a rejoin opens it again', async () => {
    const { local, sent } = await joined();
    await local.receive({ composition: SATCHEL, ref: 1, type: 'place' });
    await local.receive({ ref: 2, text: 'edit satchel', type: 'command' });
    await local.receive({ type: 'logout' });
    sent.length = 0;
    await local.receive({ name: 'Ada', type: 'join' });
    expect(events(sent, 'compose')).toHaveLength(1);

    sent.length = 0;
    await local.receive({ ref: 's', type: 'stop_editing' });
    expect(lastReply(sent)).toEqual({ event: 'reply', ok: true, ref: 's' });
    await local.receive({ ref: 3, text: 'look', type: 'command' });
    expect(events(sent, 'closed')).toEqual([]);
  });

  test("refuses with the World's reason, and with the Channel's for a malformed message", async () => {
    const { local, sent } = await joined();
    await local.receive({ composition: SATCHEL, ref: 1, type: 'place' });
    const { eid } = lastReply(sent) as { eid: number };

    await local.receive({ eid, ref: 2, type: 'store' });
    expect(lastReply(sent)).toEqual({
      event: 'reply',
      ok: false,
      reason: 'Open it with edit first.',
      ref: 2
    });
    await local.receive({
      composition: { ...SATCHEL, container: { capacity: 21 } },
      ref: 3,
      type: 'place'
    });
    expect(lastReply(sent)).toMatchObject({ ok: false, ref: 3 });
    expect((lastReply(sent) as { reason: string }).reason).toContain(
      'can hold at most 20'
    );
    await local.receive({
      composition: 'satchel' as unknown as Record<string, unknown>,
      type: 'place'
    });
    expect(lastReply(sent)).toEqual({
      event: 'reply',
      ok: false,
      reason: 'a place needs a composition'
    });
  });

  test('gives a snapshot of what the Character perceives, for Try it', async () => {
    const { local, sent } = await open();
    await local.receive({ ref: 1, type: 'snapshot' });
    expect(lastReply(sent)).toEqual({
      event: 'reply',
      ok: false,
      reason: 'not_joined',
      ref: 1
    });

    await local.receive({ name: 'Ada', type: 'join' });
    const { character } = events(sent, 'joined')[0]!;
    await local.receive({ ref: 2, type: 'snapshot' });
    const reply = lastReply(sent);
    expect(reply).toMatchObject({ ok: true, ref: 2 });
    const snapshot = reply && 'snapshot' in reply ? reply.snapshot : undefined;
    expect(snapshot?.character).toBe(character);
    expect(
      snapshot?.components.described?.map(r => r.name as string)
    ).toContain('Crate');
  });

  test('a World saved before it could build builds after loading', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mua-local-')), 'world.db');
    const first = await joined(path);
    const { store } = first.local.world;
    const { character } = events(first.sent, 'joined')[0]!;
    const account = get(store, character, 'player')?.account as number;
    // as such a save was: no builder, and no Suggestions in the outbox
    remove(store, account, 'builder');
    store.db.exec('ALTER TABLE mua_outbox DROP COLUMN suggestions');
    first.local.close();

    const second = await joined(path);
    expect(events(second.sent, 'joined')[0]?.builder).toMatchObject({
      max_placed: 50,
      placed: 0
    });
    await second.local.receive({ composition: SATCHEL, ref: 1, type: 'place' });
    expect(lastReply(second.sent)).toMatchObject({ ok: true, placed: 1 });
    expect(events(second.sent, 'output').at(-1)).toEqual({
      event: 'output',
      lines: ['You make the satchel.'],
      suggestions: ['edit the satchel']
    });
  });
});

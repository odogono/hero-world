// The Connection (#304), played without a browser: against a Local World's
// host in this process, through the Local World's adapter, and against a
// fake adapter for what a World can't be made to do on cue.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';
import type { FromWorld, ToWorld } from 'mua-local';
import { openTestHost } from 'mua-local/testing';

import { ignore, type Adapter, type Reply, type WorldEvent } from '../adapter';
import { createConnection } from '../create-connection';
import { localAdapter } from '../local-adapter';
import { actions, builder, editing, lines, saving, status } from '../store';

const SATCHEL = {
  container: { capacity: 5, is_closed: true },
  described: { description: 'A leather satchel.', name: 'Satchel' },
  item: {}
};

afterEach(() => {
  actions.value = [];
  builder.value = null;
  editing.value = null;
  lines.value = [];
  saving.value = false;
  status.value = 'connecting';
});

const texts = () =>
  lines.value.flatMap(line => ('text' in line ? [line.text] : []));

/**
 * A Connection to a Local World in this process. Its messages are handled
 * one at a time, in order, as the Worker handles them, and nothing ticks
 * it; `settled` waits for every one sent so far, and what they answered.
 */
const playLocal = (path?: string) => {
  let receive: (message: FromWorld) => void = ignore;
  const host = openTestHost(message => receive(message), path);
  let queue: Promise<unknown> = Promise.resolve();
  const kept: Uint8Array[] = [];
  let closed = false;
  const local = localAdapter({
    close: () => {
      closed = true;
    },
    keep: bytes => kept.push(bytes),
    name: 'Ada',
    post: (message: ToWorld) => {
      queue = queue.then(() => host.receive(message));
    }
  });
  receive = local.receive;
  const connection = createConnection(local.adapter);

  const settled = async () => {
    let seen;
    do {
      seen = queue;
      await seen;
      // let what the World answered run, which may send more
      await new Promise(resolve => setTimeout(resolve, 0));
    } while (seen !== queue);
  };

  return {
    closed: () => closed,
    connection,
    kept,
    settled
  };
};

// a Snapshot as a Local World would reply with it
const snapshotOf = (character: number) => ({
  character,
  components: {},
  place: 1
});

const joinedLocal = async (path?: string) => {
  const played = playLocal(path);
  await played.settled();
  return played;
};

describe('a Connection to a Local World', () => {
  test('joins its Character, as a Builder, and shows its room', async () => {
    await joinedLocal();
    expect(status.value).toBe('joined');
    expect(builder.value).toEqual({
      max_capacity: 20,
      max_placed: 50,
      placed: 0
    });
    expect(texts()).toContain(
      "Welcome, Ada! Type 'look' to begin, or 'help' for the commands."
    );
    expect(actions.value).toContain('north');
    expect(saving.value).toBe(true);
  });

  test("doesn't send before the Character has joined", async () => {
    const { connection, settled } = playLocal();
    expect(connection.sendCommand('look')).toBe(false);
    expect(await connection.place(SATCHEL)).toEqual({
      ok: false,
      reason: "You aren't connected."
    });
    await settled();
  });

  test('confirms a command once its Step has committed', async () => {
    const { connection, settled } = await joinedLocal();
    expect(connection.sendCommand('north')).toBe(true);
    expect(lines.value.at(-1)).toMatchObject({
      kind: 'command',
      state: 'pending',
      text: 'north'
    });
    await settled();
    expect(lines.value.find(line => line.kind === 'command')).toMatchObject({
      state: 'confirmed'
    });
    expect(texts().join('\n')).toContain('The Square');
  });

  test("shows the World's reason for refusing a command", async () => {
    const { connection, settled } = await joinedLocal();
    connection.sendCommand('x'.repeat(501));
    await settled();
    expect(lines.value.find(line => line.kind === 'command')).toMatchObject({
      state: 'unconfirmed'
    });
    expect(texts()).toContain('Not sent: too_long');
  });

  test('places, edits, stores and destroys a satchel, keeping the count', async () => {
    const { connection, settled } = await joinedLocal();

    const placed = await connection.place(SATCHEL);
    expect(placed).toEqual({ eid: expect.any(Number), ok: true });
    expect(builder.value?.placed).toBe(1);
    // the Suggestion goes with its line, as online
    expect(lines.value).toContainEqual(
      expect.objectContaining({
        kind: 'output',
        suggestions: ['edit the satchel'],
        text: 'You make the satchel.'
      })
    );
    const eid = placed.ok ? placed.eid : 0;

    connection.sendCommand('edit satchel');
    await settled();
    expect(editing.value?.eid).toBe(eid);

    const saved = await connection.saveEdit(eid, {
      put: { described: { description: 'A battered satchel.' } },
      remove: []
    });
    expect(saved).toEqual({ ok: true });
    expect(editing.value).toBeNull();

    connection.sendCommand('edit satchel');
    await settled();
    expect(await connection.putAway(eid, 'store')).toEqual({ ok: true });
    expect(editing.value).toBeNull();
    expect(builder.value?.placed).toBe(1);

    connection.sendCommand('unstore satchel');
    connection.sendCommand('edit satchel');
    await settled();
    expect(await connection.putAway(eid, 'destroy')).toEqual({ ok: true });
    expect(builder.value?.placed).toBe(0);
    expect(texts()).toContain('You unmake the satchel.');
  });

  test("refuses a place with the World's reason", async () => {
    const { connection } = await joinedLocal();
    const placed = await connection.place({ nonsense: {} });
    expect(placed).toEqual({ ok: false, reason: expect.any(String) });
    expect(builder.value?.placed).toBe(0);
  });

  test('closes the thing without saving, in the World too', async () => {
    const { connection, settled } = await joinedLocal();
    await connection.place(SATCHEL);
    connection.sendCommand('edit satchel');
    await settled();
    expect(editing.value).not.toBeNull();
    connection.stopEditing();
    expect(editing.value).toBeNull();
    await settled();
    // the World closed it too: editing the satchel again opens it afresh
    connection.sendCommand('edit satchel');
    await settled();
    expect(editing.value).not.toBeNull();
  });

  test('gives Try it a snapshot of what the Character perceives', async () => {
    const { connection } = await joinedLocal();
    expect(await connection.snapshot()).toMatchObject({
      character: expect.any(Number)
    });
  });

  test('says why Try it has no snapshot before the Character has joined (#313)', async () => {
    const local = localAdapter({
      close: ignore,
      keep: ignore,
      name: 'Ada',
      post: ignore
    });
    const asked = local.adapter.snapshot();
    local.receive({
      event: 'reply',
      ok: false,
      reason: 'not_joined',
      ref: 'r1'
    });
    await expect(asked).rejects.toThrow(
      "Try it couldn't read where you stand: not_joined"
    );
  });

  test('settles each snapshot by its own reply, however late (#313)', async () => {
    const posted: ToWorld[] = [];
    const local = localAdapter({
      close: ignore,
      keep: ignore,
      name: 'Ada',
      post: message => posted.push(message)
    });
    const first = local.adapter.snapshot();
    const second = local.adapter.snapshot();
    const [one, two] = posted.map(message =>
      'ref' in message ? message.ref : undefined
    );
    // the second is answered first: the first is still waiting for its own
    local.receive({
      event: 'reply',
      ok: true,
      ref: two,
      snapshot: snapshotOf(2)
    });
    expect((await second)?.character).toBe(2);
    local.receive({
      event: 'reply',
      ok: true,
      ref: one,
      snapshot: snapshotOf(1)
    });
    expect((await first)?.character).toBe(1);
  });

  test('gives up on a snapshot when a saved World is loaded in its place (#313)', async () => {
    const local = localAdapter({
      close: ignore,
      keep: ignore,
      name: 'Ada',
      post: ignore
    });
    const asked = local.adapter.snapshot();
    local.receive({ event: 'loaded' });
    await expect(asked).rejects.toThrow(
      "Try it couldn't read where you stand: a saved World was loaded in its place"
    );
  });

  test('saves the World, and loads it back in place of this one', async () => {
    const { connection, kept, settled } = await joinedLocal(
      join(mkdtempSync(join(tmpdir(), 'mua-client-')), 'world.db')
    );
    await connection.place(SATCHEL);
    connection.save();
    await settled();
    expect(kept).toHaveLength(1);
    expect(texts()).toContain('Saved your world as mua-world.db.');

    connection.sendCommand('edit satchel');
    await settled();
    expect(editing.value).not.toBeNull();

    await connection.load(new Blob([kept[0]! as BlobPart]));
    await settled();
    // the saved World plays from here on: nothing of the old one is open
    expect(texts()[0]).toBe('Loaded a saved world.');
    expect(lines.value.some(line => line.kind === 'gap')).toBe(false);
    expect(editing.value).toBeNull();
    expect(status.value).toBe('joined');
    expect(builder.value?.placed).toBe(1);
  });

  test('says a file that is no World was not loaded', async () => {
    const { connection, settled } = await joinedLocal();
    await connection.load(new Blob(['not a world']));
    await settled();
    expect(texts()).toContain('Not loaded: That file is not a saved World');
    expect(status.value).toBe('joined');
  });

  test('logs out to Limbo and lets go of the World', async () => {
    const played = await joinedLocal();
    const leaving = played.connection.logout();
    await played.settled();
    await leaving;
    expect(status.value).toBe('limbo');
    expect(texts()).toContain('You have left the world.');
    expect(played.closed()).toBe(true);
    expect(builder.value).toBeNull();
    expect(saving.value).toBe(false);
  });
});

/**
 * An adapter that answers as each test says, as a Channel might: late, with
 * an error, or after dropping
 */
const fakeAdapter = (answer: (type: string) => Promise<Reply>) => {
  let listen: (event: WorldEvent) => void = ignore;
  let connected = true;
  const adapter: Adapter = {
    canSend: () => connected,
    close: () => {},
    join: listener => {
      listen = listener;
    },
    logout: () => Promise.resolve(),
    request: type => answer(type),
    snapshot: () => new Promise(() => {})
  };
  return {
    adapter,
    disconnect: () => {
      connected = false;
      listen({ event: 'dropped' });
    },
    reconnect: () => {
      connected = true;
      listen({ builder: null, event: 'joined' });
    },
    tell: (event: WorldEvent) => listen(event)
  };
};

const never = () => new Promise<Reply>(() => {});

describe('a Connection whatever its World', () => {
  test('gives up on a request the World never answers', async () => {
    const fake = fakeAdapter(never);
    const connection = createConnection(fake.adapter, { timeout: 5 });
    fake.tell({
      builder: { max_capacity: 20, max_placed: 50, placed: 0 },
      event: 'joined'
    });

    expect(await connection.place(SATCHEL)).toEqual({
      ok: false,
      reason: 'No answer from the World yet.'
    });
    expect(await connection.saveEdit(1, { put: {}, remove: [] })).toEqual({
      ok: false,
      reason: 'No answer from the World yet: it may have been saved.'
    });
    expect(await connection.putAway(1, 'store')).toEqual({
      ok: false,
      reason: 'No answer from the World yet: it may have been done.'
    });
    await expect(connection.snapshot()).rejects.toThrow(
      "Try it couldn't read where you stand: No answer from the World yet."
    );
    // the count stays as the World last said
    expect(builder.value?.placed).toBe(0);

    connection.sendCommand('look');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(lines.value.at(-1)).toMatchObject({
      kind: 'command',
      state: 'unconfirmed'
    });
  });

  test("passes on a mirror's failure to give Try it a snapshot (#310)", async () => {
    const fake = fakeAdapter(never);
    fake.adapter.snapshot = () =>
      Promise.reject(new Error("Try it couldn't read where you stand: gone"));
    const connection = createConnection(fake.adapter, { timeout: 5 });
    fake.tell({ builder: null, event: 'joined' });
    await expect(connection.snapshot()).rejects.toThrow(
      "Try it couldn't read where you stand: gone"
    );
  });

  test("passes on the World's reason for an error reply", async () => {
    const fake = fakeAdapter(() =>
      Promise.resolve({ ok: false, reason: 'too_heavy' })
    );
    const connection = createConnection(fake.adapter);
    fake.tell({ builder: null, event: 'joined' });
    expect(await connection.place(SATCHEL)).toEqual({
      ok: false,
      reason: 'too_heavy'
    });
    connection.sendCommand('lift anvil');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(texts()).toContain('Not sent: too_heavy');
  });

  test('sends nothing while the link is down, and marks the gap on rejoining', async () => {
    let asked = 0;
    const fake = fakeAdapter(() => {
      asked++;
      return never();
    });
    const connection = createConnection(fake.adapter);
    fake.tell({ builder: null, event: 'joined' });
    connection.sendCommand('look');

    fake.disconnect();
    expect(status.value).toBe('offline');
    // the command sent just before may or may not have run
    expect(lines.value.at(-1)).toMatchObject({ state: 'unconfirmed' });
    expect(connection.sendCommand('north')).toBe(false);
    expect(await connection.place(SATCHEL)).toEqual({
      ok: false,
      reason: "You aren't connected."
    });
    expect(asked).toBe(1);

    fake.reconnect();
    expect(status.value).toBe('joined');
    expect(lines.value.at(-1)).toMatchObject({ kind: 'gap', reason: 'drop' });
  });

  test('says when another window has taken over', () => {
    const fake = fakeAdapter(never);
    createConnection(fake.adapter);
    fake.tell({ builder: null, event: 'joined' });
    fake.tell({ event: 'status', status: 'replaced' });
    expect(status.value).toBe('replaced');
    expect(texts()).toContain('You are playing in another window now.');
  });

  test("can't save or load a World that can't be", async () => {
    const fake = fakeAdapter(never);
    const connection = createConnection(fake.adapter);
    expect(saving.value).toBe(false);
    // nothing to do, and nothing goes wrong
    connection.save();
    await connection.load(new Blob(['x']));
    expect(lines.value).toEqual([]);
  });
});

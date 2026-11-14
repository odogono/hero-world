// The client's Mirror (#164, #314), on the real mirror handler in this
// process: Try it recovers from a Mirror out of step or dead by asking the
// server for a fresh one, without reconnecting.
import { describe, expect, test } from 'bun:test';
import type { MirrorSnapshot } from 'mua-local';
import { openTestMirrorWorker } from 'mua-local/testing';

import type { Reply } from '../adapter';
import { mirrorKeeper } from '../mirror-keeper';

const ROOM = 1;
const ADA = 2;
const LAMP = 3;

const snapshotOf = (description: string): MirrorSnapshot => ({
  character: ADA,
  components: {
    described: [
      { description, eid: ROOM, name: 'Room' },
      { description: 'A lamp.', eid: LAMP, name: 'Lamp' }
    ],
    location: [
      { eid: ADA, in: ROOM },
      { eid: LAMP, in: ROOM }
    ]
  },
  place: ROOM
});

const descriptionOf = (snapshot: MirrorSnapshot) =>
  snapshot.components.described?.find(row => row.eid === ROOM)?.description;

/** A Mirror whose server answers `mirror` with `answer`, counting asks */
const keep = (answer: () => Promise<Reply>) => {
  const workers: ReturnType<typeof openTestMirrorWorker>[] = [];
  let asked = 0;
  const keeper = mirrorKeeper({
    ask: () => {
      asked++;
      return answer();
    },
    start: () => {
      const worker = openTestMirrorWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { asked: () => asked, keeper, workers };
};

const fresh = () =>
  Promise.resolve<Reply>({
    ok: true,
    payload: snapshotOf('A fresh room.')
  });

describe("the client's Mirror", () => {
  test('gives the snapshot the server sent, and follows its changes', async () => {
    const { asked, keeper } = keep(fresh);
    keeper.load(snapshotOf('A room.'));
    keeper.apply({ gone: [LAMP], place: ROOM, put: {}, remove: {} });
    const taken = await keeper.snapshot();
    expect(descriptionOf(taken)).toBe('A room.');
    expect(taken.components.described).toHaveLength(1);
    expect(asked()).toBe(0);
  });

  test('asks the server afresh once its Worker has died, and keeps the new one', async () => {
    const { asked, keeper, workers } = keep(fresh);
    keeper.load(snapshotOf('A room.'));
    expect(descriptionOf(await keeper.snapshot())).toBe('A room.');
    workers[0]!.kill();

    expect(descriptionOf(await keeper.snapshot())).toBe('A fresh room.');
    expect(asked()).toBe(1);
    expect(workers).toHaveLength(2);
    // from the new Worker, following the changes after it
    keeper.apply({ gone: [LAMP], place: ROOM, put: {}, remove: {} });
    expect((await keeper.snapshot()).components.described).toHaveLength(1);
    expect(asked()).toBe(1);
  });

  test('asks the server afresh once it is out of step', async () => {
    const { asked, keeper } = keep(fresh);
    keeper.load(snapshotOf('A room.'));
    // a change set it can't read
    keeper.apply({ gone: null, place: ROOM, put: {}, remove: {} } as never);
    expect(descriptionOf(await keeper.snapshot())).toBe('A fresh room.');
    expect(asked()).toBe(1);
  });

  test("says why when the server can't give a fresh one either", async () => {
    const { keeper } = keep(() =>
      Promise.resolve({ ok: false, reason: 'not_in_play' })
    );
    await expect(keeper.snapshot()).rejects.toThrow(
      "Try it couldn't read where you stand: not_in_play"
    );
  });

  test('says when the server gave no answer', async () => {
    const { keeper } = keep(() =>
      Promise.resolve({ ok: false, timeout: true })
    );
    await expect(keeper.snapshot()).rejects.toThrow(
      "Try it couldn't read where you stand: No answer from the World yet."
    );
  });
});

import { describe, expect, it } from 'bun:test';
import { defineComponent, s } from 'odgn-ecs/component';
import { eventComponent, getAllEvents } from 'odgn-ecs/events';
import { createWorld } from 'odgn-ecs/world';

import { num, quantity } from '@northtalk/ts';

import {
  TALK_SHOW_EVENT,
  createEcsTalk,
  locationComponent,
  talkTimerComponent
} from '../index';

const metaComponent = defineComponent({
  id: 'meta' as const,
  schema: { props: s.json() }
});

const EDL = `
atom bell {}

entity tower : bell {
  meta { props: { id: "tower" } }
}

entity chapel : bell {
  meta { props: { id: "chapel" } }
}
`;

/** After a delay, rings for whoever armed it; can be told to stop */
const BELL = `
on arm actor, delay
  ask clock to now
  tell timer to schedule "ring", it + delay, "ring", [actor]
end arm

on disarm
  tell timer to cancel "ring"
end disarm

on ring who
  show who, "ding"
end ring
`;

const setup = async () => {
  const world = await createWorld([
    metaComponent,
    locationComponent,
    eventComponent,
    talkTimerComponent
  ]);
  world.executeEDL(EDL);
  let now = 1_000_000_000_000n;
  const ecsTalk = createEcsTalk(world, { clock: () => now });
  ecsTalk.loadAtomScript('bell', BELL);
  const idOf = (metaId: string) =>
    world
      .queryAll({ with: ['meta'] })
      .find(e => (e.meta.props as { id: string }).id === metaId)!.id;
  /** Moves the clock on, then pumps, as a game loop tick would */
  const advance = async (seconds: number) => {
    now += BigInt(seconds) * 1_000_000n;
    ecsTalk.pump();
    world.flush();
    await Bun.sleep(0);
  };
  const shown = () =>
    getAllEvents(world as never, TALK_SHOW_EVENT).map(
      e => e.payload as { actor: number; text: string }
    );
  const timers = () => world.queryAll({ with: ['talkTimer'] });
  return { advance, ecsTalk, idOf, shown, timers, world };
};

const seconds = (n: number) => quantity(num(n), 's');

describe('timer Capability', () => {
  it('delivers a timer to the entity whose Run set it', async () => {
    const { advance, ecsTalk, idOf, shown, timers } = await setup();
    const tower = idOf('tower');
    const chapel = idOf('chapel');

    ecsTalk.deliver(tower, 'arm', ecsTalk.handle(chapel).value, seconds(5));
    await advance(0);
    expect(timers()).toHaveLength(1);
    expect(timers()[0]!.talkTimer.owner).toBe(tower);

    await advance(4);
    expect(shown()).toEqual([]);

    await advance(1);
    await advance(0);
    expect(shown()).toEqual([{ actor: chapel, text: 'ding' }]);
    expect(timers()).toHaveLength(0);
  });

  it('scopes timer names to the entity, though they share a Script', async () => {
    const { advance, ecsTalk, idOf, timers } = await setup();
    const tower = idOf('tower');
    const chapel = idOf('chapel');

    ecsTalk.deliver(tower, 'arm', ecsTalk.handle(tower).value, seconds(5));
    ecsTalk.deliver(chapel, 'arm', ecsTalk.handle(chapel).value, seconds(5));
    await advance(0);

    expect(
      timers()
        .map(t => t.talkTimer.owner)
        .toSorted()
    ).toEqual([tower, chapel].toSorted());
  });

  it('replaces a timer of the same name, and cancels one', async () => {
    const { advance, ecsTalk, idOf, timers } = await setup();
    const tower = idOf('tower');
    const self = ecsTalk.handle(tower).value;

    ecsTalk.deliver(tower, 'arm', self, seconds(5));
    ecsTalk.deliver(tower, 'arm', self, seconds(9));
    await advance(0);
    expect(timers()).toHaveLength(1);

    ecsTalk.deliver(tower, 'disarm');
    await advance(0);
    expect(timers()).toHaveLength(0);
  });

  it('keeps timers in the World, so another adapter fires them', async () => {
    const { advance, ecsTalk, idOf, world } = await setup();
    const tower = idOf('tower');
    ecsTalk.deliver(tower, 'arm', ecsTalk.handle(tower).value, seconds(5));
    await advance(0);

    // a fresh adapter, as after a restart, over the same World
    const later = 1_000_010_000_000n;
    const restarted = createEcsTalk(world, { clock: () => later });
    restarted.loadAtomScript('bell', BELL);
    restarted.pump();
    world.flush();
    await Bun.sleep(0);
    restarted.pump();
    world.flush();

    const events = getAllEvents(world as never, TALK_SHOW_EVENT);
    expect(events.map(e => e.payload)).toContainEqual({
      actor: tower,
      text: 'ding'
    });
  });

  it('lets the Host schedule timers and handle them itself', async () => {
    const world = await createWorld([
      metaComponent,
      locationComponent,
      eventComponent,
      talkTimerComponent
    ]);
    world.executeEDL(EDL);
    let now = 1_000_000_000_000n;
    const handled: string[] = [];
    const ecsTalk = createEcsTalk(world, {
      clock: () => now,
      onTimer: timer => {
        if (timer.script !== 'host') {
          return false;
        }
        handled.push(`${timer.owner}:${timer.message}`);
        return true;
      }
    });
    ecsTalk.loadAtomScript('bell', BELL);
    const tower = world
      .queryAll({ with: ['meta'] })
      .find(e => (e.meta.props as { id: string }).id === 'tower')!.id;

    ecsTalk.schedule({
      at: now + 5_000_000n,
      message: 'reset',
      name: 'reset',
      owner: tower,
      script: 'host'
    });
    now += 5_000_000n;
    ecsTalk.pump();
    world.flush();

    expect(handled).toEqual([`${tower}:reset`]);
    expect(world.queryAll({ with: ['talkTimer'] })).toHaveLength(0);
  });
});

describe('timers on a mixed Message Path', () => {
  it("keeps a copied Script's timers under its atom's name", async () => {
    const world = await createWorld([
      metaComponent,
      locationComponent,
      eventComponent,
      talkTimerComponent
    ]);
    world.executeEDL(`
      atom bell {}
      atom loud {}
      entity belfry : loud bell {
        meta { props: { id: "belfry" } }
      }
    `);
    const now = 1_000_000_000_000n;
    const ecsTalk = createEcsTalk(world, { clock: () => now });
    ecsTalk.loadAtomScript('bell', BELL);
    // on belfry's path loud follows bell, so belfry reaches a copy of bell
    ecsTalk.loadAtomScript('loud', 'on shout\n  return 1\nend shout');
    const belfry = world.queryAll({ with: ['meta'] })[0]!.id;

    ecsTalk.deliver(belfry, 'arm', ecsTalk.handle(belfry).value, seconds(5));
    ecsTalk.pump();
    world.flush();
    await Bun.sleep(0);
    const timers = () => world.queryAll({ with: ['talkTimer'] });
    expect(timers().map(t => t.talkTimer.script)).toEqual(['bell']);

    ecsTalk.deliver(belfry, 'disarm');
    ecsTalk.pump();
    world.flush();
    await Bun.sleep(0);
    expect(timers()).toHaveLength(0);
  });
});

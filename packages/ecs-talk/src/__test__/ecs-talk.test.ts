import { describe, expect, it } from 'bun:test';
import { defineComponent, s } from 'odgn-ecs/component';
import { eventComponent, getAllEvents } from 'odgn-ecs/events';
import { createGameLoop } from 'odgn-ecs/system';
import { createWorld } from 'odgn-ecs/world';

import { num, talk, text, type Report, type Value } from '@northtalk/ts';

import { TALK_SHOW_EVENT, createEcsTalk, locationComponent } from '../index';

const metaComponent = defineComponent({
  id: 'meta' as const,
  schema: { props: s.json() }
});

const statsComponent = defineComponent({
  id: 'stats' as const,
  schema: {
    hp: s.int(),
    mood: s.enum(['calm', 'angry']).default('calm')
  }
});

const itemComponent = defineComponent({
  id: 'item' as const,
  schema: { weight: s.float().default(1) }
});

const EDL = `
atom thing {
  stats { hp: 10 }
}

atom person: thing {
  stats { hp: 20 }
}

entity room {
  meta { props: { id: "hall" } }
}

entity cellar {
  meta { props: { id: "cellar" } }
}

entity hero: person {
  meta { props: { id: "hero" } }
  location { in: $room }
}

entity lamp {
  meta { props: { id: "lamp" } }
  location { in: $room }
  item { weight: 2 }
}

entity dust {
  location { in: $room }
}
`;

/** A World built from EDL and `more`, with ecs-talk and a game loop */
const setup = async (more = '') => {
  const world = await createWorld([
    metaComponent,
    statsComponent,
    itemComponent,
    locationComponent,
    eventComponent
  ]);
  world.executeEDL(EDL + more);

  const byName = (id: string) =>
    world.query({
      args: [id],
      where: `json_extract(meta.props, '$.id') = ?1`,
      with: ['meta']
    })!.id;

  const reports: Report[] = [];
  let now = 1_000_000n;
  const ecsTalk = createEcsTalk(world, {
    clock: () => (now += 1000n),
    onPump: result => reports.push(...result.reports)
  });
  const loop = createGameLoop(world, { throwErrors: true }).addSystem(
    'talk',
    ecsTalk.system
  );

  return { byName, ecsTalk, loop, reports, world };
};

const tick = (loop: { update: (dt: number) => void }) => loop.update(16);

// text as written; other kinds in their display form
const show = (v: Value) => v.asText() ?? String(v);

/** A World built from this EDL, with a way to ask its entities */
const linearized = async (edl: string) => {
  const world = await createWorld([metaComponent, statsComponent]);
  world.executeEDL(edl);
  const ecsTalk = createEcsTalk(world);
  const byName = (id: string) =>
    world.query({
      args: [id],
      where: `json_extract(meta.props, '$.id') = ?1`,
      with: ['meta']
    })!.id;
  const ask = async (eid: number, message: string) => {
    const reply = ecsTalk.request(eid, message);
    ecsTalk.pump();
    return show(await reply.result);
  };
  return { ask, byName, ecsTalk };
};

describe('ecs-talk', () => {
  it('runs an atom Script against the World', async () => {
    const { byName, ecsTalk, loop, world } = await setup();
    const hero = byName('hero');
    const room = byName('hall');

    ecsTalk.loadAtomScript(
      'person',
      talk`
        on inspect
          put the stats of the target into before
          set the stats of the target to {hp: the hp of before - 5}
          put the location of the target into loc
          return before
        end inspect

        on survey place
          put the number of elements of place into n
          put element "lamp" of place into lamp
          return {count: n, lamp: the weight of the item of lamp, first: element 1 of place = the target}
        end survey
      `
    );

    const inspected = ecsTalk.request(hero, 'inspect');
    tick(loop);
    expect(show(await inspected.result)).toBe('{hp: 20, mood: "calm"}');

    // the write is visible in the World after the Pump and flush
    const stored = world.query({
      entity: { id: hero, world },
      with: ['stats']
    })!;
    expect(stored.stats.hp).toBe(15);
    expect(stored.stats.mood).toBe('calm');

    const surveyed = ecsTalk.request(
      hero,
      'survey',
      ecsTalk.handle(room).value
    );
    tick(loop);
    expect(show(await surveyed.result)).toBe(
      '{count: 3, lamp: 2, first: true}'
    );
  });

  it('reads a missing component as Nothing', async () => {
    const { byName, ecsTalk, loop } = await setup();
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on peek
          return the item of the target is nothing
        end peek
      `
    );
    const reply = ecsTalk.request(byName('hero'), 'peek');
    tick(loop);
    expect(show(await reply.result)).toBe('true');
  });

  it('fails the Run on an invalid component value', async () => {
    const { byName, ecsTalk, loop, reports, world } = await setup();
    const hero = byName('hero');
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on enrage
          set the stats of the target to {hp: 1, mood: "furious"}
        end enrage
      `
    );
    const reply = ecsTalk.request(hero, 'enrage');
    tick(loop);
    await expect(reply.result).rejects.toThrow();
    const runEnd = reports.find(r => r.kind === 'run end');
    expect(runEnd).toMatchObject({
      error: { code: 'invalid value' },
      outcome: 'errored'
    });
    const stored = world.query({
      entity: { id: hero, world },
      with: ['stats']
    })!;
    expect(stored.stats.hp).toBe(20);
  });

  it('climbs an unhandled message to the base atom Script', async () => {
    const { byName, ecsTalk, loop } = await setup();
    ecsTalk.loadAtomScript(
      'thing',
      talk`
        on describe
          return "a thing with " & the hp of the stats of the target
        end describe
      `
    );
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on greet
          return "hello"
        end greet
      `
    );

    const hero = byName('hero');
    const greeting = ecsTalk.request(hero, 'greet');
    const described = ecsTalk.request(hero, 'describe');
    tick(loop);
    expect(show(await greeting.result)).toBe('hello');
    expect(show(await described.result)).toBe('a thing with 20');
  });

  it('runs a Service Script that no entity climbs to', async () => {
    const { byName, ecsTalk, loop } = await setup();
    ecsTalk.loadServiceScript(
      'weigher',
      talk`
        on weigh thing
          return the hp of the stats of thing
        end weigh

        on beforeLift thing, deciding
          if the hp of the stats of thing > 15 then
            veto "too heavy"
          end if
        end beforeLift
      `
    );
    const hero = ecsTalk.handle(byName('hero')).value;

    const weighed = ecsTalk.requestService('weigher', 'weigh', hero);
    const lifted = ecsTalk.decideService('weigher', 'beforeLift', hero);
    // the hero's own Message Path doesn't reach it
    const unreached = ecsTalk.request(byName('hero'), 'weigh', hero);
    tick(loop);

    expect(show(await weighed.result)).toBe('20');
    expect((await lifted.decided).verdict).toBe('vetoed');
    await expect(unreached.result).rejects.toMatchObject({
      reason: 'unhandled'
    });
    expect(() => ecsTalk.requestService('nobody', 'weigh')).toThrow(
      'No Service Script named nobody'
    );
  });

  it('finds, moves and shows through the world Capability', async () => {
    const { byName, ecsTalk, loop, world } = await setup();
    const hero = byName('hero');
    const cellar = byName('cellar');
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on fetch place, dest
          ask world to find place, "item"
          put it into items
          moveTo item 1 of items, dest
          show the target, "moved " & the length of items
          return the number of elements of dest
        end fetch
      `
    );

    const reply = ecsTalk.request(
      hero,
      'fetch',
      ecsTalk.handle(byName('hall')).value,
      ecsTalk.handle(cellar).value
    );
    tick(loop);
    expect(show(await reply.result)).toBe('1');

    const lamp = world.query({
      entity: { id: byName('lamp'), world },
      with: ['location']
    })!;
    expect(lamp.location.in).toBe(cellar);

    const events = getAllEvents(world as never, TALK_SHOW_EVENT);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ actor: hero, text: 'moved 1' });
  });

  it('routes a send to a Handle first made inside the same Run', async () => {
    const { byName, ecsTalk, loop, world } = await setup(`
      entity yard {
        meta { props: { id: "yard" } }
      }

      entity rat: thing {
        meta { props: { id: "rat" } }
        location { in: $yard }
      }
    `);
    ecsTalk.loadAtomScript(
      'thing',
      talk`
        on scan place
          send hail to element 1 of place
        end scan

        on hail
          show the target, "hailed"
        end hail
      `
    );

    // The rat's Handle is first made by `element 1 of place`, inside the
    // hero's Run.
    ecsTalk.request(
      byName('hero'),
      'scan',
      ecsTalk.handle(byName('yard')).value
    );
    tick(loop);

    const events = getAllEvents(world as never, TALK_SHOW_EVENT);
    expect(events.map(e => e.payload)).toEqual([
      { actor: byName('rat'), text: 'hailed' }
    ]);
  });

  it('drops the Handle of a deleted entity', async () => {
    const { byName, ecsTalk, loop, world } = await setup();
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on peekAt thing
          return the item of thing
        end peekAt
      `
    );
    const hero = byName('hero');
    const lamp = byName('lamp');
    const lampHandle = ecsTalk.handle(lamp);

    world.delete({ id: lamp });
    // deleted but not yet dropped: the stale Handle reads as Nothing
    const stale = ecsTalk.request(hero, 'peekAt', lampHandle.value);
    tick(loop);
    expect(show(await stale.result)).toBe('nothing');

    // next Pump drops it: the Handle is gone
    const gone = ecsTalk.request(hero, 'peekAt', lampHandle.value);
    tick(loop);
    await expect(gone.result).rejects.toThrow();
    expect(ecsTalk.handle(hero)).toBe(ecsTalk.handle(hero));
  });

  describe('Message Path across several bases', () => {
    it('reaches every base Script, rightmost first', async () => {
      const { ask, byName, ecsTalk } = await linearized(`
        atom a { stats { hp: 1 } }
        atom b { stats { hp: 2 } }
        entity both: a b { meta { props: { id: "both" } } }
      `);
      ecsTalk.loadAtomScript(
        'a',
        'on who\n  return "a"\nend who\non onlyA\n  return "from a"\nend onlyA'
      );
      ecsTalk.loadAtomScript('b', 'on who\n  return "b"\nend who');

      const both = byName('both');
      expect(await ask(both, 'who')).toBe('b');
      expect(await ask(both, 'onlyA')).toBe('from a');
    });

    it('puts a shared ancestor after every atom built on it', async () => {
      const { ask, byName, ecsTalk } = await linearized(`
        atom thing { stats { hp: 1 } }
        atom box: thing {}
        atom fragile: thing {}
        entity vase: box fragile { meta { props: { id: "vase" } } }
      `);
      ecsTalk.loadAtomScript(
        'thing',
        'on order\n  return "thing"\nend order\non base\n  return "thing"\nend base'
      );
      ecsTalk.loadAtomScript('box', 'on order\n  return "box"\nend order');
      ecsTalk.loadAtomScript('fragile', 'on other\n  return 1\nend other');

      const vase = byName('vase');
      // fragile doesn't answer `order`; box comes before their shared thing
      expect(await ask(vase, 'order')).toBe('box');
      expect(await ask(vase, 'base')).toBe('thing');
    });

    it('gives an atom a parent for each path it sits on', async () => {
      const { ask, byName, ecsTalk } = await linearized(`
        atom a { stats { hp: 1 } }
        atom b { stats { hp: 2 } }
        entity plain: a { meta { props: { id: "plain" } } }
        entity mixed: b a { meta { props: { id: "mixed" } } }
      `);
      ecsTalk.loadAtomScript('a', 'on who\n  pass who\nend who');
      ecsTalk.loadAtomScript('b', 'on who\n  return "b"\nend who');

      // on mixed's path, a passes to b; on plain's, a has no parent
      expect(await ask(byName('mixed'), 'who')).toBe('b');
      const reply = ecsTalk.request(byName('plain'), 'who');
      ecsTalk.pump();
      await expect(reply.result).rejects.toThrow();
    });

    it('re-links paths when an atom Script loads later', async () => {
      const { ask, byName, ecsTalk } = await linearized(`
        atom a { stats { hp: 1 } }
        atom b { stats { hp: 2 } }
        entity both: a b { meta { props: { id: "both" } } }
      `);
      ecsTalk.loadAtomScript('b', 'on who\n  return "b"\nend who');
      const both = byName('both');
      expect(await ask(both, 'who')).toBe('b');

      ecsTalk.loadAtomScript('a', 'on onlyA\n  return "a"\nend onlyA');
      expect(await ask(both, 'onlyA')).toBe('a');
    });
  });

  it('passes text through a Handler argument', async () => {
    const { byName, ecsTalk } = await setup();
    ecsTalk.loadAtomScript('person', 'on echo s\n  return s & "!"\nend echo');
    const reply = ecsTalk.request(byName('hero'), 'echo', text('hi'));
    ecsTalk.pump();
    expect(show(await reply.result)).toBe('hi!');
  });
});

describe('links and Decisions', () => {
  const linkComponent = defineComponent({
    id: 'link' as const,
    schema: { locked: s.boolean().default(false), to: s.entityId().optional() }
  });

  const setupLinks = async () => {
    const world = await createWorld([linkComponent, eventComponent]);
    world.executeEDL(`
      atom place { link {} }
      entity far: place {}
      entity near: place { link { to: $far } }
      entity shut: place { link { to: $far locked: true } }
    `);
    const byTo = (locked: boolean) =>
      world
        .queryAll({ with: ['link'] })
        .find(e => e.link.to && e.link.locked === locked)!.id;
    const ecsTalk = createEcsTalk(world);
    ecsTalk.loadAtomScript(
      'place',
      talk`
        on go
          ask world to resolve the to of the link of the target
          send arrive to it
        end go

        on arrive
          show the target, "arrived"
        end arrive

        on probe id
          ask world to resolve id
          return it is nothing
        end probe

        on beforeGo, deciding
          if the locked of the link of the target then veto "locked"
        end beforeGo
      `
    );
    return { byTo, ecsTalk, world };
  };

  it('delivers to an entity a Script first reaches inside a Run', async () => {
    const { byTo, ecsTalk, world } = await setupLinks();
    ecsTalk.deliver(byTo(false), 'go');
    ecsTalk.pump();
    ecsTalk.pump();
    world.flush();
    const events = getAllEvents(world as never, TALK_SHOW_EVENT);
    expect(events.map(e => e.payload)).toEqual([
      {
        actor: world.queryAll({ with: ['link'] }).find(e => !e.link.to)!.id,
        text: 'arrived'
      }
    ]);
  });

  it('resolves an id that names no entity to Nothing', async () => {
    const { byTo, ecsTalk } = await setupLinks();
    const reply = ecsTalk.request(byTo(false), 'probe', num(9999));
    ecsTalk.pump();
    expect(show(await reply.result)).toBe('true');
  });

  it('answers a Decision with a veto reason', async () => {
    const { byTo, ecsTalk } = await setupLinks();
    const open = ecsTalk.decide(byTo(false), 'beforeGo');
    const shut = ecsTalk.decide(byTo(true), 'beforeGo');
    ecsTalk.pump();
    expect((await open.decided).verdict).toBe('allowed');
    const vetoed = await shut.decided;
    expect(vetoed.verdict).toBe('vetoed');
    expect(show(vetoed.vetoes[0]!.reason)).toBe('locked');
  });
});

describe('script owners', () => {
  it('lists the atoms and entities whose EDL declares a script', async () => {
    const scriptComponent = defineComponent({
      id: 'script' as const,
      schema: { src: s.string() }
    });
    const world = await createWorld([statsComponent, scriptComponent]);
    world.executeEDL(
      `
      atom person {
        stats { hp: 20 }
        script { src: "person.talk" }
      }
      entity hero: person {}
      entity boss: person {
        script { src: "boss.talk" }
      }
      `,
      { path: '/game/main.edl' }
    );
    const boss = world
      .queryAll({ with: ['script'] })
      .find(e => e.script.src === 'boss.talk')!;

    expect(createEcsTalk(world).scriptOwners()).toEqual([
      { kind: 'atom', name: 'person', src: '/game/person.talk' },
      { eid: boss.id, kind: 'entity', src: '/game/boss.talk' }
    ]);
  });
});

describe('Libraries', () => {
  it('lets a Script use a function from a Library', async () => {
    const world = await createWorld([
      metaComponent,
      statsComponent,
      itemComponent,
      locationComponent,
      eventComponent
    ]);
    world.executeEDL(EDL);
    const ecsTalk = createEcsTalk(world);
    ecsTalk.addLibrary(
      'health',
      `function healthOf thing
  return the hp of the stats of thing
end healthOf`
    );
    ecsTalk.loadAtomScript(
      'person',
      `use healthOf from health

on probe
  return healthOf(the target)
end probe`
    );
    const hero = world
      .queryAll({ with: ['meta'] })
      .find(e => (e.meta.props as { id: string }).id === 'hero')!.id;

    const reply = ecsTalk.request(hero, 'probe');
    ecsTalk.pump();

    expect(show(await reply.result)).toBe('20');
  });
});

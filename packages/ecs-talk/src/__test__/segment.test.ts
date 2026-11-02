import { describe, expect, it } from 'bun:test';
import { defineComponent, s } from 'odgn-ecs/component';
import { eventComponent } from 'odgn-ecs/events';
import { createGameLoop } from 'odgn-ecs/system';
import { createWorld } from 'odgn-ecs/world';

import { defineCapability, nothing, talk, type Report } from '@northtalk/ts';

import { createEcsTalk, locationComponent } from '../index';

const metaComponent = defineComponent({
  id: 'meta' as const,
  schema: { props: s.json() }
});

const statsComponent = defineComponent({
  id: 'stats' as const,
  schema: { hp: s.int() }
});

const EDL = `
atom person {
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
`;

const setup = async () => {
  const world = await createWorld([
    metaComponent,
    statsComponent,
    locationComponent,
    eventComponent
  ]);
  world.executeEDL(EDL);

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
  const tick = () => loop.update(16);

  const hero = byName('hero');
  /** What the database holds, after a flush */
  const stored = (component: string) => {
    const { tableName } = world.defs.get(component)!;
    return world.db.query(
      `SELECT * FROM ${tableName} WHERE eid = ?1`,
      hero
    )[0] as Record<string, unknown> | undefined;
  };

  return { byName, ecsTalk, hero, reports, stored, tick, world };
};

const runEnds = (reports: Report[]) =>
  reports.filter(r => r.kind === 'run end') as (Report & {
    outcome: string;
  })[];

describe('Segment-bound world writes', () => {
  it('a Run that writes and then faults leaves no trace', async () => {
    const { byName, ecsTalk, hero, reports, stored, tick, world } =
      await setup();
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on hurt place
          change the target, "stats", {hp: 1}
          moveTo the target, place
          repeat forever
          end repeat
        end hurt
      `,
      { limits: { fuelPerRun: 500 } }
    );
    ecsTalk.deliver(hero, 'hurt', ecsTalk.handle(byName('cellar')).value);
    tick();
    tick();

    expect(runEnds(reports).map(r => r.outcome)).toEqual(['limit fault']);
    expect(stored('stats')?.hp).toBe(20);
    expect(stored('location')?.in).toBe(byName('hall'));
    expect(world.dirtyEntities.has(hero)).toBe(false);
  });

  it('a Run that writes and completes is flushed on the tick', async () => {
    const { byName, ecsTalk, hero, stored, tick } = await setup();
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on hurt place
          change the target, "stats", {hp: 1}
          moveTo the target, place
        end hurt
      `
    );

    const cellar = ecsTalk.handle(byName('cellar')).value;
    ecsTalk.deliver(hero, 'hurt', cellar);
    tick();

    expect(stored('stats')?.hp).toBe(1);
    expect(stored('location')?.in).toBe(byName('cellar'));
  });

  it('a Rewound Run that is dispatched again writes only once', async () => {
    const { ecsTalk, hero, reports, stored, tick } = await setup();
    let rewinds = 0;
    const host = defineCapability('host', {
      interrupt: {
        args: [],
        command: true,
        cost: { fuel: 1 },
        do: call => {
          if (rewinds++ === 0) {
            ecsTalk.script('person')!.rewindRun(call.runId);
          }
          return nothing;
        },
        mode: 'immediate'
      }
    });
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on hurt
          put the stats of the target into before
          change the target, "stats", {hp: the hp of before - 5}
          interrupt
        end hurt
      `,
      { grants: { host: host.grant('all', undefined) } }
    );

    ecsTalk.deliver(hero, 'hurt');
    tick();
    tick();

    expect(rewinds).toBe(2);
    expect(runEnds(reports).at(-1)?.outcome).toBe('completed');
    expect(stored('stats')?.hp).toBe(15);
  });

  it('a Run cannot change an entity another Run is changing', async () => {
    const { ecsTalk, hero, reports, world } = await setup();
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on hurt
          change the target, "stats", {hp: 1}
        end hurt
      `
    );
    const held = world.openChanges();
    held.run(() => {
      world.query({
        asProxy: true,
        entity: { id: hero, world },
        with: ['stats']
      })!.stats.hp = 2;
    });

    const hurt = ecsTalk.request(hero, 'hurt');
    ecsTalk.pump();

    await hurt.result.catch(() => undefined);
    const [end] = runEnds(reports) as unknown as { error: { code: string } }[];
    expect(end?.error.code).toBe('world busy');
    held.discard();
  });

  // NorthTalk commits a Segment that ends in an uncaught ordinary error;
  // only Limit Faults, Stop, cancellation and Rewind roll it back
  it('a Run that throws keeps the writes it made before the throw', async () => {
    const { ecsTalk, hero, reports, stored, tick } = await setup();
    ecsTalk.loadAtomScript(
      'person',
      talk`
        on hurt
          change the target, "stats", {hp: 1}
          throw {code: "boom"}
        end hurt
      `
    );

    ecsTalk.deliver(hero, 'hurt');
    tick();

    expect(runEnds(reports).map(r => r.outcome)).toEqual(['errored']);
    expect(stored('stats')?.hp).toBe(1);
  });
});

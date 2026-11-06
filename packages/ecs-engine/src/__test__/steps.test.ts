// Runs the shared Step cases in spec/ecs/steps (ADR 0021), as
// packages/odgn_ecs_engine/test/steps_test.exs does. The format is in
// spec/ecs/README.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import {
  createEcsTalk,
  location,
  outcome,
  toValue,
  type Outcome,
  type Pending
} from 'ecs-talk';
import { defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { armSystems, get, query, type Eid, type Store } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { fromValue, type Value } from '@northtalk/ts';

import {
  createEngine,
  type Delivery,
  type Engine,
  type Input,
  type StepResult
} from '../engine';
import { timerCapability } from '../timers';

const SPEC_DIR = join(import.meta.dir, '../../../../spec/ecs/steps');

type Json = Record<string, unknown>;

type Spec = {
  cases: { name: string; steps: Json[] }[];
  components: { columns: Json[]; name: string }[];
  edl: string;
  scripts: Json[];
  systems?: {
    deliver: string;
    every: number;
    name: string;
    query?: { with?: string[] };
  }[];
};

// A spec column as a Component Definition's
const columnBuilder = (col: Json) => {
  const make = {
    boolean: s.boolean,
    eid: s.entityId,
    float: s.float,
    int: s.int,
    json: s.json,
    string: s.string
  }[col.type as string];
  if (!make) {
    throw new Error(`No column type ${String(col.type)}`);
  }
  const builder = make().optional();
  return col.default === undefined
    ? builder
    : (
        builder as unknown as { default: (v: unknown) => typeof builder }
      ).default(col.default);
};

/** Each Definition-named entity's label, by id */
const labelsOf = (store: Store) =>
  new Map(
    query(store, { with: ['edl_definition'] }).map(eid => [
      eid,
      get(store, eid, 'edl_definition')!.name as string
    ])
  );

/** The ids of a Value, as the cases write them: whole numbers as numbers */
const plain = (v: Value) =>
  JSON.parse(
    JSON.stringify(fromValue(v, { maps: 'object' }), (_k, x) =>
      typeof x === 'object' && x?.constructor?.name === 'Decimal'
        ? Number(String(x))
        : x
    )
  );

// An outcome as the cases write it
const written = (o: Outcome) => {
  switch (o.kind) {
    case 'replied':
      return { replied: plain(o.value) };
    case 'vetoed':
      return { vetoed: o.reason === undefined ? null : plain(o.reason) };
    default:
      return o.kind;
  }
};

const build = async (spec: Spec) => {
  const defs = spec.components.map(c =>
    defineComponent({
      id: c.name,
      schema: Object.fromEntries(
        c.columns.map(col => [col.name as string, columnBuilder(col)])
      )
    })
  );
  const world = await createWorld([location, ...defs], {
    type: DatabaseType.BUN
  });
  world.executeEDL(spec.edl);
  world.flush();
  const { store } = world;
  const names = world.getDefinitionNames();
  const id = (label: string) => {
    const eid = names.get(label);
    if (eid === undefined) {
      throw new Error(`No entity ${label}`);
    }
    return eid;
  };

  // Output goes to a table in the World's transaction, as a Host's outbox
  // would, so a Segment or Step that rolls back sends nothing
  store.db.exec(
    'CREATE TABLE step_output (id INTEGER PRIMARY KEY, actor INTEGER, text TEXT)'
  );
  const talk = createEcsTalk(world, {
    capabilities: [timerCapability(store)],
    limits: { fuelPerRun: 5000 },
    onShow: (eid, text) =>
      store.db.exec('INSERT INTO step_output (actor, text) VALUES (?1, ?2)', [
        eid,
        text
      ])
  });
  for (const script of spec.scripts) {
    const source = script.source as string;
    if (typeof script.atom === 'string') {
      talk.loadAtomScript(script.atom, source);
    } else if (typeof script.entity === 'string') {
      talk.loadEntityScript(id(script.entity), source);
    } else {
      talk.loadServiceScript(script.service as string, source);
    }
  }

  const steps: StepResult[] = [];
  const engine = createEngine(store, talk, {
    onStep: result => steps.push(result),
    output: () => {
      const rows = store.db.query(
        'SELECT actor, text FROM step_output ORDER BY id'
      ) as { actor: Eid; text: string }[];
      store.db.exec('DELETE FROM step_output');
      return rows.map(({ actor, text }) => [actor, text]);
    },
    // A case's System delivers its message to each entity it selects
    systems: (spec.systems ?? []).map(sys => ({
      every: sys.every,
      name: sys.name,
      query: { with: sys.query?.with ?? [] },
      run: (eids, step) => {
        for (const eid of eids as Eid[]) {
          step.deliver({ message: sys.deliver, to: eid });
        }
      }
    })),
    worldTime: 0
  });
  // Every System is armed at World time 0
  armSystems(store, spec.systems ?? [], 0);
  return { engine, id, steps, store };
};

type Built = Awaited<ReturnType<typeof build>>;

const delivery = (built: Built, d: Json): Delivery => ({
  args: ((d.args as unknown[]) ?? []).map(arg =>
    arg && typeof arg === 'object' && '$ref' in arg
      ? built.engine.talk.handle(built.id((arg as { $ref: string }).$ref)).value
      : toValue(arg)
  ),
  asks: (d.asks as Delivery['asks']) ?? 'deliver',
  message: d.message as string,
  to: built.id(d.to as string)
});

/** The answer a waiting input was given, for `answered` */
let answered: unknown;

const input = (built: Built, i: Json): Input => {
  if (i.deliver) {
    return (i.deliver as Json[]).map(d => delivery(built, d));
  }
  if (i.fail) {
    return step => {
      for (const d of i.fail as Json[]) {
        step.deliver(delivery(built, d));
      }
      step.pump();
      throw new Error("the case's input fails");
    };
  }
  if (i.decide_until_veto) {
    return async step => {
      for (const d of i.decide_until_veto as Json[]) {
        const pending = step.deliver({
          ...delivery(built, d),
          asks: 'decide'
        }) as Pending;
        step.pump();
        const o = await outcome(pending);
        if (o.kind === 'vetoed') {
          return written(o);
        }
      }
      return 'passed';
    };
  }
  if (i.ask) {
    const d = i.ask as Json;
    return async step => {
      const result = await step.ask(
        delivery(built, d),
        { input: d.message as string },
        (_s, o) => {
          answered = written(o);
          return answered;
        }
      );
      if (result === 'waiting') {
        return 'waiting';
      }
      answered = undefined;
      return result;
    };
  }
  throw new Error(`Unknown input ${JSON.stringify(i)}`);
};

const checkStep = (built: Built, exp: Json, result: StepResult) => {
  const got = answered;
  answered = undefined;
  if (!result.ok) {
    expect(exp.error, `the Step failed: ${String(result.error)}`).toBe(true);
  } else {
    expect(exp.error, 'the Step committed').toBeUndefined();
    const labels = labelsOf(built.store);
    const out = result.output;
    const actual: Json = {
      answered: got,
      changes: out.changes.map(([eid, name, kind, data]) => [
        labels.get(eid),
        name,
        kind,
        data
      ]),
      output: (out.output as [Eid, string][]).map(([eid, text]) => [
        labels.get(eid),
        text
      ]),
      result: out.result,
      world_time: out.world_time
    };
    for (const key of Object.keys(actual)) {
      if (key in exp) {
        expect([key, actual[key]]).toEqual([key, exp[key]]);
      }
    }
  }
  for (const [label, components] of Object.entries(
    (exp.world as Record<string, Json>) ?? {}
  )) {
    for (const [name, data] of Object.entries(components)) {
      expect([
        label,
        name,
        get(built.store, built.id(label), name) ?? null
      ]).toEqual([label, name, data] as never);
    }
  }
};

const checkDeadline = (engine: Engine, holder: Json) => {
  if ('next_deadline' in holder) {
    expect(['next_deadline', engine.nextDeadline() ?? null]).toEqual([
      'next_deadline',
      holder.next_deadline
    ] as never);
  }
};

for (const file of readdirSync(SPEC_DIR).filter(f => f.endsWith('.json'))) {
  const spec = JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8')) as Spec;

  describe(`steps/${file}`, () => {
    for (const c of spec.cases) {
      test(c.name, async () => {
        const built = await build(spec);
        answered = undefined;
        for (const s of c.steps) {
          if ('step' in s) {
            const result = await built.engine.step(
              input(built, s.step as Json),
              s.at === undefined ? {} : { at: s.at as number }
            );
            built.steps.length = 0;
            checkStep(built, s.expect as Json, result);
            checkDeadline(built.engine, s.expect as Json);
          } else {
            await built.engine.advance(s.advance as number);
            const ran = built.steps.splice(0);
            const expected = s.expect as Json[];
            expect(ran.length, `advance ${String(s.advance)}`).toBe(
              expected.length
            );
            ran.forEach((result, i) => checkStep(built, expected[i]!, result));
            checkDeadline(built.engine, s);
          }
        }
        built.store.db.close();
      });
    }
  });
}

// Runs the shared, language-neutral cases in spec/ecs (ADR 0019), as
// packages/odgn_ecs/test/conformance_test.exs does.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { DatabaseType, createDatabase } from '../../db';
import {
  armSystems,
  component,
  createEntity,
  define,
  deleteEntity,
  dueSystems,
  ident,
  nextDue,
  openStore,
  put,
  putMany,
  query,
  remove,
  runSystem,
  select,
  takeChanges,
  type ColumnInput,
  type Condition,
  type Order,
  type QueryOptions,
  type Store,
  type System
} from '../index';

const SPEC_DIR = join(import.meta.dir, '../../../../../spec/ecs');

type Spec = {
  cases: {
    expect: unknown[];
    name: string;
    query: Record<string, unknown>;
    select?: string[];
  }[];
  components: { columns: ColumnInput[]; name: string }[];
  entities: { components?: Record<string, unknown>; id: string }[];
};

type Ids = Map<string, number>;

/** `{"$ref": label}` anywhere becomes that entity's id */
const resolve = (v: unknown, ids: Ids): unknown => {
  if (Array.isArray(v)) {
    return v.map(x => resolve(x, ids));
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$ref === 'string') {
      const id = ids.get(o.$ref);
      if (id === undefined) {
        throw new Error(`Unknown label ${o.$ref}`);
      }
      return id;
    }
    return Object.fromEntries(
      Object.entries(o).map(([k, x]) => [k, resolve(x, ids)])
    );
  }
  return v;
};

// Spec columns use the stored JSON's snake_case option names
const columnOf = (c: Record<string, unknown>): ColumnInput => ({
  caseInsensitive: c.case_insensitive as boolean | undefined,
  default: c.default,
  index: c.index as boolean | undefined,
  name: c.name as string,
  onDelete: c.on_delete as ColumnInput['onDelete'],
  optional: c.optional as boolean | undefined,
  type: c.type as ColumnInput['type'],
  unique: c.unique as boolean | undefined
});

const build = async (spec: Omit<Spec, 'cases'>) => {
  const db = await createDatabase({ type: DatabaseType.BUN });
  const store = openStore(db);
  for (const c of spec.components) {
    define(
      store,
      component(
        c.name,
        c.columns.map(col => columnOf(col as Record<string, unknown>))
      )
    );
  }
  const ids: Ids = new Map();
  for (const e of spec.entities) {
    ids.set(e.id, createEntity(store));
  }
  for (const e of spec.entities) {
    for (const [name, data] of Object.entries(e.components ?? {})) {
      put(
        store,
        ids.get(e.id)!,
        name,
        resolve(data, ids) as Record<string, unknown>
      );
    }
  }
  return { ids, store };
};

const options = (q: Record<string, unknown>, ids: Ids): QueryOptions => ({
  ...(q.with ? { with: q.with as string[] } : {}),
  ...(q.where ? { where: q.where as Condition[] } : {}),
  ...(q.eids
    ? { eids: (q.eids as string[]).map(label => ids.get(label) ?? -1) }
    : {}),
  ...(q.order_by ? { orderBy: q.order_by as Order[] } : {}),
  ...(q.limit !== undefined ? { limit: q.limit as number } : {})
});

const files = readdirSync(join(SPEC_DIR, 'query')).filter(f =>
  f.endsWith('.json')
);

for (const file of files) {
  const spec = JSON.parse(
    readFileSync(join(SPEC_DIR, 'query', file), 'utf8')
  ) as Spec;

  describe(`query/${file}`, () => {
    for (const c of spec.cases) {
      test(c.name, async () => {
        const { ids, store } = await build(spec);
        const opts = options(resolve(c.query, ids) as never, ids);
        if (c.select) {
          const actual = select(store, c.select, opts);
          const expected = (c.expect as [string, unknown][]).map(
            ([label, data]) => [ids.get(label), resolve(data, ids)]
          );
          expect(actual).toEqual(expected as never);
        } else {
          expect(query(store, opts)).toEqual(
            (c.expect as string[]).map(label => ids.get(label)!)
          );
        }
        store.db.close();
      });
    }
  });
}

type ChangeSpec = Omit<Spec, 'cases'> & {
  cases: {
    expect: [string, string, string, unknown][];
    name: string;
    ops: unknown[][];
  }[];
};

const runOp = (store: Store, ids: Ids, op: unknown[]) => {
  const [kind, a, b, c] = op as [string, string, string, unknown];
  const eid = () => ids.get(a)!;
  switch (kind) {
    case 'create':
      ids.set(a, createEntity(store));
      break;
    case 'put':
      put(store, eid(), b, resolve(c, ids) as Record<string, unknown>);
      break;
    case 'put_many':
      putMany(
        store,
        a,
        (b as unknown as [string, unknown][]).map(
          ([label, data]) =>
            [
              ids.get(label)!,
              resolve(data, ids) as Record<string, unknown>
            ] as const
        )
      );
      break;
    case 'fails': {
      // `["fails", kind, op]`: the op throws a StoreError of that kind
      let thrown: unknown;
      try {
        runOp(store, ids, b as unknown as unknown[]);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as { code?: string } | undefined)?.code).toBe(a);
      break;
    }
    case 'remove':
      remove(store, eid(), b);
      break;
    case 'delete':
      deleteEntity(store, eid());
      break;
    case 'begin':
      store.db.exec('BEGIN IMMEDIATE');
      break;
    case 'commit':
      store.db.exec('COMMIT');
      break;
    case 'rollback':
      store.db.exec('ROLLBACK');
      break;
    case 'savepoint':
      store.db.exec(`SAVEPOINT ${ident(a)}`);
      break;
    case 'rollback_to':
      store.db.exec(`ROLLBACK TO ${ident(a)}`);
      store.db.exec(`RELEASE ${ident(a)}`);
      break;
    default:
      throw new Error(`Unknown op ${kind}`);
  }
};

const changeFiles = readdirSync(join(SPEC_DIR, 'changes')).filter(f =>
  f.endsWith('.json')
);

for (const file of changeFiles) {
  const spec = JSON.parse(
    readFileSync(join(SPEC_DIR, 'changes', file), 'utf8')
  ) as ChangeSpec;

  describe(`changes/${file}`, () => {
    for (const c of spec.cases) {
      // Builds the World, takes its change set, runs the case's ops, and
      // takes the change set again
      test(c.name, async () => {
        const { ids, store } = await build(spec);
        takeChanges(store);
        for (const op of c.ops) {
          runOp(store, ids, op);
        }
        const expected = c.expect.map(([label, name, kind, data]) => [
          ids.get(label),
          name,
          kind,
          resolve(data, ids)
        ]);
        expect(takeChanges(store)).toEqual(expected as never);
        store.db.close();
      });
    }
  });
}

type SystemSpec = Omit<Spec, 'cases'> & {
  cases: { name: string; ops: unknown[][] }[];
  systems: {
    every: number;
    name: string;
    query: Record<string, unknown>;
    select?: string[];
  }[];
};

const systemFiles = readdirSync(join(SPEC_DIR, 'systems')).filter(f =>
  f.endsWith('.json')
);

for (const file of systemFiles) {
  const spec = JSON.parse(
    readFileSync(join(SPEC_DIR, 'systems', file), 'utf8')
  ) as SystemSpec;

  describe(`systems/${file}`, () => {
    for (const c of spec.cases) {
      test(c.name, async () => {
        const { ids, store } = await build(spec);
        const systems = new Map<string, System<undefined, unknown>>(
          spec.systems.map(s => [
            s.name,
            {
              every: s.every,
              name: s.name,
              query: options(resolve(s.query, ids) as never, ids),
              run: entities => entities,
              ...(s.select ? { select: s.select } : {})
            }
          ])
        );
        const named = (names: string[]) => names.map(n => systems.get(n)!);
        const labels = new Map([...ids].map(([label, eid]) => [eid, label]));
        for (const op of c.ops) {
          const [kind, a, b, d] = op as [string, unknown, unknown, unknown];
          switch (kind) {
            case 'arm':
              armSystems(store, named(a as string[]), b as number);
              break;
            case 'due':
              expect(
                dueSystems(store, named(a as string[]), b as number).map(
                  s => s.name
                )
              ).toEqual(d as string[]);
              break;
            case 'next_due':
              expect(nextDue(store, named(a as string[])) ?? null).toEqual(
                b as number | null
              );
              break;
            case 'run': {
              const ran = runSystem(
                store,
                systems.get(a as string)!,
                b as number,
                undefined
              ) as (number | [number, unknown])[];
              expect(
                ran.map(e =>
                  Array.isArray(e) ? [labels.get(e[0]), e[1]] : labels.get(e)
                )
              ).toEqual(resolve(d, ids) as never);
              break;
            }
            default:
              runOp(store, ids, op);
          }
        }
        store.db.close();
      });
    }
  });
}

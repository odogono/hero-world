// Runs the shared, language-neutral cases in spec/ecs (ADR 0019), as
// packages/odgn_ecs/test/conformance_test.exs does.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { DatabaseType, createDatabase } from '../../db';
import {
  component,
  createEntity,
  define,
  openStore,
  put,
  query,
  select,
  type ColumnInput,
  type Condition,
  type Order,
  type QueryOptions
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

const build = async (spec: Spec) => {
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

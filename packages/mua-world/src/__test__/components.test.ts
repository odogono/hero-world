// Both Hosts define mua's components alike (spec/mua/components), as
// packages/mua_world/test/components_test.exs checks the Elixir one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { toJSON } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { components } from '../index';

const SPEC_FILE = join(
  import.meta.dir,
  '../../../../spec/mua/components/components.json'
);

type Stored = { columns: { name: string }[] };

/** Each definition as the store holds it, with its columns sorted by name */
const defined = async () => {
  const world = await createWorld(components, { type: DatabaseType.BUN });
  return Object.fromEntries(
    components.map(({ id }) => {
      const c = world.store.components.get(id);
      if (!c) {
        throw new Error(`${id} is not defined`);
      }
      const stored = JSON.parse(toJSON(c)) as Stored;
      stored.columns.sort((a, b) => a.name.localeCompare(b.name));
      return [id, stored];
    })
  );
};

describe('components', () => {
  test("mua's components are those both Hosts agree on", async () => {
    const spec = JSON.parse(readFileSync(SPEC_FILE, 'utf8')) as unknown;
    expect(await defined()).toEqual(spec as Record<string, Stored>);
  });

  test('a builder composes from described, noun, item, container and readable', async () => {
    const world = await createWorld(components, { type: DatabaseType.BUN });
    const buildable = [...world.store.components.values()]
      .filter(c => c.buildable)
      .map(c => c.name)
      .sort();
    expect(buildable).toEqual([
      'container',
      'described',
      'item',
      'noun',
      'readable'
    ]);
  });
});

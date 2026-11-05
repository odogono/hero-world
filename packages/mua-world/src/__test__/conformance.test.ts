// Runs the shared, language-neutral command cases in spec/mua/commands
// (ADR 0024), as packages/mua_world/test/commands/conformance_test.exs does:
// what a typed line reads as, before any Action runs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get, put } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { Exits, components, fromWorld, read } from '../index';

const REPO = join(import.meta.dir, '../../../..');
const SPEC_DIR = join(REPO, 'spec/mua/commands');
const ROOTS = { 'mua-scripts': join(REPO, 'packages/mua-scripts') };

type Case = { expect: unknown; input: string | string[]; name: string };
type Spec = { actor: string; cases: Case[]; edl: string };

const build = async (path: string) => {
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(readFileSync(path, 'utf8'), { path, roots: ROOTS });
  world.flush();
  Exits.expand(world.store);
  return world;
};

const runCase = async (spec: Spec, c: Case): Promise<unknown> => {
  const world = await build(join(SPEC_DIR, spec.edl));
  const { store } = world;
  const vocabulary = fromWorld(store);
  const definitions = world.getDefinitionNames();
  const actor = definitions.get(spec.actor)!;
  const names = new Map([...definitions].map(([name, eid]) => [eid, name]));

  let result: ReturnType<typeof read>[0] | undefined;
  for (const line of [c.input].flat()) {
    const [r, changes] = read(store, vocabulary, actor, line);
    put(store, actor, 'player', { ...get(store, actor, 'player'), ...changes });
    result = r;
  }

  if (result?.kind === 'reply') {
    return { reply: result.message };
  }
  return {
    commands: (result?.commands ?? []).map(command =>
      Object.fromEntries(
        Object.entries({
          direction: command.direction,
          indirect:
            command.indirectId === null
              ? undefined
              : names.get(command.indirectId),
          target:
            command.targetId === null ? undefined : names.get(command.targetId),
          text: command.text,
          verb: command.verb
        }).filter(([, v]) => v != null)
      )
    )
  };
};

for (const file of readdirSync(SPEC_DIR).filter(f => f.endsWith('.json'))) {
  const spec = JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8')) as Spec;
  describe(file, () => {
    for (const c of spec.cases) {
      test(c.name, async () => {
        expect(await runCase(spec, c)).toEqual(c.expect);
      });
    }
  });
}

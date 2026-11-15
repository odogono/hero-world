// The Actions, Service Scripts and Libraries a World declares (ADR 0029), as mua_world's
// test/gameplay/actions_test.exs has it: a World whose Verbs ask for what it
// hasn't declared won't start. What a declared Action reaches is pinned by
// the Step cases in spec/mua/steps/actions.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { createWorld } from 'odgn-ecs/world';

import { components, startMuaWorld } from '../index';

const REPO = join(import.meta.dir, '../../../..');
const SCRIPTS = join(REPO, 'packages/mua-scripts');

const start = async (extra: string) => {
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(
    `include "mua-scripts:edl/base.edl"

    entity hall {
      container { capacity: 100 is_closed: false }
      described { name: "Hall" description: "A plain hall." }
    }

    ${extra}`,
    { path: join(REPO, 'main.edl'), roots: { 'mua-scripts': SCRIPTS } }
  );
  world.flush();
  return startMuaWorld(world, {
    clock: () => 0,
    readFile: file => readFileSync(file, 'utf8'),
    scriptsDir: SCRIPTS,
    startingRoom: 'hall'
  });
};

describe('a World', () => {
  test("won't start when a form asks for an undeclared Action", async () => {
    await expect(
      start(`entity more_verbs {
        verbs { defs: [{ names: ["wave"] forms: [{ action: "wave" pattern: "" }] }] }
      }`)
    ).rejects.toThrow("wave asks for the Action wave, which isn't declared");
  });

  test("won't start when an Action names an undeclared Service", async () => {
    await expect(
      start(`entity more_actions {
        actions { defs: { take: { service: "pockets" } } }
      }`)
    ).rejects.toThrow(
      "the Action take names the Service pockets, which isn't declared"
    );
  });

  test("won't start when a Veto asks an undeclared Service", async () => {
    await expect(
      start(`entity more_verbs {
        verbs {
          defs: [{
            names: ["wave"]
            forms: [{ action: "wave" pattern: "" }]
            vetoes: [{ event: "beforeWave" asks: "service:crowd" about: "actor" }]
          }]
        }
        actions { defs: { wave: {} } }
      }`)
    ).rejects.toThrow(
      "beforeWave asks the Service crowd, which isn't declared"
    );
  });

  test("won't start when a Service's src is under an unknown root", async () => {
    await expect(
      start(`entity more_services {
        services { defs: { thing: { src: "elsewhere:thing.talk" } } }
      }`)
    ).rejects.toThrow(
      "the Service thing's src elsewhere:thing.talk is under no root mua knows"
    );
  });

  test("won't start when a Library's src is under an unknown root", async () => {
    await expect(
      start(`entity more_libraries {
        libraries { defs: { manners: { src: "elsewhere:manners.talk" } } }
      }`)
    ).rejects.toThrow(
      "the Library manners's src elsewhere:manners.talk is under no root mua knows"
    );
  });

  test('starts with a Receivers-only Action declared', async () => {
    await start(`entity more_verbs {
      verbs { defs: [{ names: ["wave"] forms: [{ action: "wave" pattern: "" }] }] }
      actions { defs: { wave: {} } }
    }`);
  });
});

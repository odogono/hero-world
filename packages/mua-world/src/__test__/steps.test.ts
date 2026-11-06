// Runs the shared mua Step cases in spec/mua/steps (ADR 0024), as
// packages/mua_world/test/steps_conformance_test.exs does. The format is in
// spec/mua/steps/README.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get, type Eid } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { components, startMuaWorld, type MuaWorld } from '../index';

const REPO = join(import.meta.dir, '../../../..');
const SPEC_DIR = join(REPO, 'spec/mua/steps');
const SCRIPTS = join(REPO, 'packages/mua-scripts');

type Step = Record<string, unknown>;
type Case = { join: string[]; name: string; steps: Step[] };
type Spec = { cases: Case[]; edl: string; starting_room: string };

const start = async (spec: Spec) => {
  const path = join(SPEC_DIR, spec.edl);
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(readFileSync(path, 'utf8'), {
    path,
    roots: { 'mua-scripts': SCRIPTS }
  });
  world.flush();
  return startMuaWorld(world, {
    clock: () => 0,
    readFile: file => readFileSync(file, 'utf8'),
    scriptsDir: SCRIPTS,
    startingRoom: spec.starting_room
  });
};

/** Joins a Character with an Account of its own, and hears its output */
const join_ = async (mua: MuaWorld, name: string) => {
  const account = await mua.createAccount();
  const eid = await mua.createCharacter(account, name);
  await mua.enter(account, eid);
  const heard: string[] = [];
  await mua.subscribe(eid, line => heard.push(line));
  return { account, eid, heard };
};

type Joined = Awaited<ReturnType<typeof join_>>;

// Every Character's lines since the last step, for those given any; the
// typer's echo of what it was told is left out of its own
const heardSince = (
  characters: Map<string, Joined>,
  typed?: { name: string; told: string[] }
) => {
  const out: Record<string, string[]> = {};
  for (const [name, c] of characters) {
    let lines = c.heard.splice(0);
    if (typed?.name === name) {
      const told = [...typed.told];
      lines = lines.filter(line => {
        const i = told.indexOf(line);
        if (i === -1) {
          return true;
        }
        told.splice(i, 1);
        return false;
      });
    }
    if (lines.length > 0) {
      out[name] = lines;
    }
  }
  return out;
};

const runCase = async (spec: Spec, c: Case) => {
  const mua = await start(spec);
  const characters = new Map<string, Joined>();
  for (const name of c.join) {
    characters.set(name, await join_(mua, name));
  }
  // what joining told everyone is not the case's
  heardSince(characters);

  const eid = async (name: string): Promise<Eid> => {
    const id = characters.get(name)?.eid ?? (await mua.named(name));
    if (id === undefined) {
      throw new Error(`No entity ${name}`);
    }
    return id;
  };

  for (const step of c.steps) {
    if ('where' in step) {
      const where = step.where as Record<string, string>;
      for (const [thing, place] of Object.entries(where)) {
        const at = get(mua.store, await eid(thing), 'location')?.in;
        expect([thing, at]).toEqual([thing, await eid(place)]);
      }
    } else if ('advance' in step) {
      for (let i = 0; i < (step.advance as number); i++) {
        await mua.advance(1000);
        await mua.tick();
      }
      expect(['advance', heardSince(characters)]).toEqual([
        'advance',
        step.heard ?? {}
      ] as never);
    } else {
      const name = step.as as string;
      const who = characters.get(name)!;
      const told = await mua.command(who.account, who.eid, step.type as string);
      const label = `${name}: ${String(step.type)}`;
      if ('told' in step) {
        expect([label, told]).toEqual([label, step.told] as never);
      }
      expect([label, heardSince(characters, { name, told })]).toEqual([
        label,
        step.heard ?? {}
      ] as never);
    }
  }
};

for (const file of readdirSync(SPEC_DIR).filter(f => f.endsWith('.json'))) {
  const spec = JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8')) as Spec;
  describe(file, () => {
    for (const c of spec.cases) {
      test(c.name, () => runCase(spec, c));
    }
  });
}

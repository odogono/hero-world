// Runs the shared mua Step cases in spec/mua/steps (ADR 0024), as
// packages/mua_world/test/steps_conformance_test.exs does. The format is in
// spec/mua/steps/README.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get, put, type Eid } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import {
  MuaWorldError,
  components,
  startMuaWorld,
  type MirrorSnapshot,
  type MuaWorld,
  type Told
} from '../index';

const REPO = join(import.meta.dir, '../../../..');
const SPEC_DIR = join(REPO, 'spec/mua/steps');
const SCRIPTS = join(REPO, 'packages/mua-scripts');

type Step = Record<string, unknown>;
/** A name, or `{name, builder}` for a Character whose Account builds */
type Join = string | { builder?: Record<string, unknown>; name: string };
type Case = { join: Join[]; name: string; steps: Step[] };
type Spec = { cases: Case[]; edl: string; starting_room: string };

const start = async (spec: Spec) => {
  const path = join(SPEC_DIR, spec.edl);
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(readFileSync(path, 'utf8'), {
    path,
    roots: { 'mua-scripts': SCRIPTS }
  });
  world.flush();
  const mua = await startMuaWorld(world, {
    clock: () => 0,
    readFile: file => readFileSync(file, 'utf8'),
    scriptsDir: SCRIPTS,
    startingRoom: spec.starting_room
  });
  return { definitions: world.getDefinitionNames(), mua };
};

/**
 * A line as the cases write it: a Picture by its `src`, whose URL changes
 * with the file, and a line that offers Suggestions with them
 */
type SpecLine =
  string | { picture: string } | { suggestions: string[]; text: string };

const asSpec = (told: Told, suggestions?: string[]): SpecLine => {
  if (typeof told !== 'string') {
    return { picture: told.picture.src };
  }
  return suggestions?.length ? { suggestions, text: told } : told;
};

const same = (a: SpecLine, b: SpecLine) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Joins a Character with an Account of its own, and hears its output */
const join_ = async (mua: MuaWorld, name: string) => {
  const account = await mua.createAccount();
  const eid = await mua.createCharacter(account, name);
  await mua.enter(account, eid);
  const heard: SpecLine[] = [];
  await mua.subscribe(eid, (told, suggestions) =>
    heard.push(asSpec(told, suggestions))
  );
  return { account, eid, heard };
};

type Joined = Awaited<ReturnType<typeof join_>>;

// Every Character's lines since the last step, for those given any; the
// typer's echo of what it was told is left out of its own
const heardSince = (
  characters: Map<string, Joined>,
  typed?: { name: string; told: SpecLine[] }
) => {
  const out: Record<string, SpecLine[]> = {};
  for (const [name, c] of characters) {
    let lines = c.heard.splice(0);
    if (typed?.name === name) {
      const told = [...typed.told];
      lines = lines.filter(line => {
        const i = told.findIndex(t => same(t, line));
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

/**
 * A mirror snapshot by label, as the Elixir runner gives it: each perceived
 * entity's shown components, with every id a label. An exit with no
 * Definition name is its place's label and its direction, as `hall north`.
 */
const labelled = (
  snapshot: MirrorSnapshot,
  named: (eid: Eid) => string | undefined
) => {
  const rows = Object.values(snapshot.components).flat();
  const label = (eid: unknown): string => {
    const name = typeof eid === 'number' ? named(eid) : undefined;
    if (name !== undefined) {
      return name;
    }
    const at = rows.find(r => r.eid === eid && 'in' in r)?.in;
    const dir = rows.find(r => r.eid === eid && 'dir' in r)?.dir;
    if (at !== undefined && typeof dir === 'string') {
      return `${label(at)} ${dir}`;
    }
    throw new Error(`No label for ${String(eid)}`);
  };
  const refs = (name: string, field: string, value: unknown) =>
    (name === 'location' && field === 'in') ||
    (name === 'portal' && field === 'door' && value !== null)
      ? label(value)
      : value;

  const sees: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [name, list] of Object.entries(snapshot.components)) {
    for (const { eid, ...fields } of list) {
      (sees[label(eid)] ??= {})[name] = Object.fromEntries(
        Object.entries(fields).map(([f, v]) => [f, refs(name, f, v)])
      );
    }
  }
  return { place: label(snapshot.place), sees };
};

/**
 * What one of the Composer's requests gave: what the actor was sent, its
 * refusal if any, and the Account's count of placed things when the reply
 * gives one
 */
const composed = async (
  characters: Map<string, Joined>,
  name: string,
  call: () => Promise<unknown>
) => {
  let refused: string | undefined;
  let reply: unknown;
  try {
    reply = await call();
  } catch (error) {
    if (!(error instanceof MuaWorldError)) {
      throw error;
    }
    refused = error.code;
  }
  const heard = heardSince(characters);
  const told = heard[name] ?? [];
  delete heard[name];
  const { maxPlaced, placed } = (reply ?? {}) as {
    maxPlaced?: number;
    placed?: number;
  };
  return {
    heard,
    placed: placed === undefined ? undefined : [placed, maxPlaced],
    refused,
    told
  };
};

/** The Composer's step kinds, each with an `as` */
const COMPOSER = ['place', 'save', 'store', 'destroy', 'close'] as const;

const runCase = async (spec: Spec, c: Case) => {
  const { definitions, mua } = await start(spec);
  const characters = new Map<string, Joined>();
  for (const j of c.join) {
    const name = typeof j === 'string' ? j : j.name;
    const joined = await join_(mua, name);
    if (typeof j !== 'string') {
      put(mua.store, joined.account, 'builder', j.builder ?? {});
    }
    characters.set(name, joined);
  }
  // placed things, by the `label` their `place` step gave them
  const labels = new Map<string, Eid>();
  // what joining told everyone is not the case's
  heardSince(characters);

  const eid = async (name: string): Promise<Eid> => {
    const id =
      characters.get(name)?.eid ?? labels.get(name) ?? (await mua.named(name));
    if (id === undefined) {
      throw new Error(`No entity ${name}`);
    }
    return id;
  };

  const named = (id: Eid) =>
    [...characters].find(([, c]) => c.eid === id)?.[0] ??
    [...labels].find(([, e]) => e === id)?.[0] ??
    [...definitions].find(([, e]) => e === id)?.[0];

  for (const step of c.steps) {
    if ('mirror' in step) {
      const name = step.mirror as string;
      const who = characters.get(name)!;
      const snapshot = await mua.mirror(who.account, who.eid);
      expect(snapshot.character).toBe(who.eid);
      expect([name, labelled(snapshot, named)]).toEqual([
        name,
        { place: step.place, sees: step.sees }
      ] as never);
    } else if ('where' in step) {
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
    } else if (COMPOSER.some(kind => kind in step)) {
      const name = step.as as string;
      const who = characters.get(name)!;
      const kind = COMPOSER.find(k => k in step)!;
      const label = `${name}: ${kind} ${JSON.stringify(step[kind])}`;
      const thing = async () => eid(step[kind] as string);
      const actual = await composed(characters, name, async () => {
        switch (kind) {
          case 'place': {
            const placed = await mua.place(who.account, who.eid, step.place);
            if (typeof step.label === 'string') {
              labels.set(step.label, placed.eid);
            }
            return placed;
          }
          case 'save':
            return mua.edit(
              who.account,
              who.eid,
              await thing(),
              step.patch as never
            );
          case 'close':
            return mua.stopEditing(who.account, who.eid);
          default:
            return mua.putAway(who.account, who.eid, await thing(), kind);
        }
      });
      if ('told' in step) {
        expect([label, actual.told]).toEqual([label, step.told] as never);
      }
      expect([label, actual.refused]).toEqual([label, step.refused] as never);
      if ('placed' in step) {
        expect([label, actual.placed]).toEqual([label, step.placed] as never);
      }
      expect([label, actual.heard]).toEqual([label, step.heard ?? {}] as never);
    } else {
      const name = step.as as string;
      const who = characters.get(name)!;
      const told = (
        await mua.command(who.account, who.eid, step.type as string)
      ).map(told => asSpec(told));
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

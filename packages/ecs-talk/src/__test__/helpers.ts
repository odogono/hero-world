import { defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { get } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { fromValue, type Value } from '@northtalk/ts';

import {
  createEcsTalk,
  location,
  outcome,
  type EcsTalkOptions,
  type Outcome,
  type Pending
} from '../ecs-talk';
import { isDecimal } from '../values';

// As `OdgnEcsTalk.Case`'s components
const meta = defineComponent({
  id: 'meta',
  schema: { props: s.json().optional() }
});
const stats = defineComponent({
  id: 'stats',
  schema: { hp: s.int().optional(), mood: s.string().default('calm') }
});
const item = defineComponent({
  id: 'item',
  schema: { weight: s.float().default(1) }
});
const link = defineComponent({
  id: 'link',
  schema: { locked: s.boolean().default(false), to: s.entityId() }
});
const script = defineComponent({
  id: 'script',
  schema: { src: s.string().optional() }
});

export const components = [location, meta, stats, item, link, script];

/** A World built from `edl`, in memory */
export const buildWorld = async (edl: string, path?: string) => {
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(edl, path ? { path } : undefined);
  world.flush();
  const names = world.getDefinitionNames();
  return {
    get: (eid: number, name: string) => get(world.store, eid, name),
    id: (name: string) => names.get(name)!,
    world
  };
};

export type Shown = [number, string][];

/** An adapter that records what `show` shows */
export const startTalk = (
  world: Awaited<ReturnType<typeof buildWorld>>['world'],
  options: EcsTalkOptions = {}
) => {
  const shown: Shown = [];
  const talk = createEcsTalk(world, {
    onShow: (eid, text) => shown.push([eid, text]),
    ...options
  });
  return { shown, talk };
};

export type Talk = ReturnType<typeof startTalk>['talk'];

export const EPOCH = 946_684_800_000_000n;

/** The Clock `ms` after the epoch, in microseconds */
export const now = (ms = 0) => EPOCH + BigInt(ms) * 1000n;

/** Pumps until a Request or Decision settles */
export const settle = async (
  talk: Talk,
  pending: Pending,
  tries = 20
): Promise<Outcome> => {
  for (let i = 0; i < tries; i++) {
    const result = await outcome(pending);
    if (result.kind !== 'waiting') {
      return result;
    }
    talk.pump(now());
  }
  return outcome(pending);
};

/** Requests a message of an entity, Pumping until it settles */
export const ask = (
  talk: Talk,
  eid: number,
  message: string,
  args: Value[] = []
) => settle(talk, talk.request(eid, message, args, now()));

// Whole Decimals as numbers, others as their text, such as "2.0"
const plain = (v: unknown): unknown => {
  if (isDecimal(v)) {
    const s = v.toString();
    return /^-?\d+$/.test(s) ? Number(s) : s;
  }
  if (Array.isArray(v)) {
    return v.map(plain);
  }
  if (v && typeof v === 'object' && v.constructor === Object) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
};

/** A reply's plain value */
export const value = (result: Outcome) => {
  if (result.kind === 'replied') {
    return plain(fromValue(result.value, { maps: 'object' }));
  }
  return result.kind === 'passed' ? undefined : result;
};

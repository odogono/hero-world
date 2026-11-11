// Adapted from packages/odgn_ecs_talk/test/odgn_ecs_talk_test.exs, case for
// case, so the two Hosts stay in step (ADR 0021).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  LoadError,
  ScriptError,
  defineCapability,
  nothing,
  num,
  text,
  type Value
} from '@northtalk/ts';

import {
  ScriptLoadError,
  outcome,
  type EcsTalk,
  type Pending
} from '../ecs-talk';
import { linearize } from '../message-path';
import {
  ask,
  buildWorld,
  now,
  settle,
  startTalk,
  value,
  type Talk
} from './helpers';

const EDL = `
atom thing { stats { hp: 10 } }
atom person: thing { stats { hp: 20 } }
entity hall { meta { props: { id: "hall" } } }
entity cellar { meta { props: { id: "cellar" } } }
entity hero: person {
  meta { props: { id: "hero" } }
  location { in: $hall }
}
entity lamp {
  meta { props: { id: "lamp" } }
  location { in: $hall }
  item { weight: 2 }
}
entity dust { location { in: $hall } }
`;

const setup = async (more = '') => {
  const built = await buildWorld(EDL + more);
  return { ...built, ...startTalk(built.world) };
};

const h = (talk: Talk, eid: number) => talk.handle(eid).value;

const plain = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v, (_k, x) =>
      typeof x === 'object' && x?.constructor?.name === 'Decimal'
        ? String(x)
        : x
    )
  );

describe('Handles', () => {
  test('read components and Elements', async () => {
    const { id, talk } = await setup();
    talk.loadAtomScript(
      'person',
      `on inspect
  return the stats of the target
end inspect

on survey place
  put the number of elements of place into n
  put element "lamp" of place into lamp
  return {count: n, lamp: the weight of the item of lamp, first: element 1 of place = the target}
end survey`
    );
    const hero = id('hero');
    expect(value(await ask(talk, hero, 'inspect'))).toEqual({
      hp: 20,
      mood: 'calm'
    });
    const survey = value(
      await ask(talk, hero, 'survey', [h(talk, id('hall'))])
    );
    expect(plain(survey)).toEqual({ count: 3, first: true, lamp: '2.0' });
  });

  test('read a missing component as Nothing', async () => {
    const { id, talk } = await setup();
    talk.loadAtomScript(
      'person',
      'on peek\n  return the item of the target is nothing\nend peek'
    );
    expect(value(await ask(talk, id('hero'), 'peek'))).toBe(true);
  });

  test('pass text through a Handler argument', async () => {
    const { id, talk } = await setup();
    talk.loadAtomScript('person', 'on echo s\n  return s & "!"\nend echo');
    expect(value(await ask(talk, id('hero'), 'echo', [text('hi')]))).toBe(
      'hi!'
    );
  });
});

describe('the world Capability', () => {
  test('finds an entity by its Definition name, or Nothing', async () => {
    const { id, talk } = await setup();
    talk.loadAtomScript(
      'person',
      'on lookup name\n  ask world to named name\n  return it\nend lookup'
    );
    const found = await ask(talk, id('hero'), 'lookup', [text('lamp')]);
    expect(found.kind === 'replied' && found.value).toBe(h(talk, id('lamp')));
    expect(
      value(await ask(talk, id('hero'), 'lookup', [text('nowhere')]))
    ).toBe(null);
  });

  test('finds, moves and shows', async () => {
    const { get, id, shown, talk } = await setup();
    const hero = id('hero');
    const cellar = id('cellar');
    talk.loadAtomScript(
      'person',
      `on fetch place, dest
  ask world to find place, "item"
  put it into items
  moveTo item 1 of items, dest
  show the target, "moved " & the length of items
  return the number of elements of dest
end fetch`
    );
    const args = [h(talk, id('hall')), h(talk, cellar)];
    expect(value(await ask(talk, hero, 'fetch', args))).toBe(1);
    expect(get(id('lamp'), 'location')).toEqual({ in: cellar });
    expect(shown).toEqual([[hero, 'moved 1']]);
  });

  test("a change that doesn't fit its component fails the Run and writes nothing", async () => {
    const { get, id, talk } = await setup();
    const hero = id('hero');
    talk.loadAtomScript(
      'person',
      'on enrage\n  change the target, "stats", {hp: "lots"}\nend enrage'
    );
    const result = await ask(talk, hero, 'enrage');
    expect(result.kind === 'failed' && result.error).toBeInstanceOf(
      ScriptError
    );
    expect(get(hero, 'stats')?.hp).toBe(20);
  });

  test("removes a component, and refuses one the World doesn't define", async () => {
    const { get, id, talk } = await setup();
    const hero = id('hero');
    talk.loadAtomScript(
      'person',
      `on calm
  remove the target, "stats"
end calm

on forget
  remove the target, "nonesuch"
end forget`
    );
    await ask(talk, hero, 'calm');
    expect(get(hero, 'stats')).toBeUndefined();
    const result = await ask(talk, hero, 'forget');
    expect(result.kind === 'failed' && result.error).toBeInstanceOf(
      ScriptError
    );
  });

  test('a Run that writes and then faults leaves no trace', async () => {
    const { get, id, talk } = await setup();
    const hero = id('hero');
    talk.loadAtomScript(
      'person',
      `on hurt place
  change the target, "stats", {hp: 1}
  moveTo the target, place
  repeat forever
  end repeat
end hurt`,
      { limits: { fuelPerRun: 500 } }
    );
    const result = await ask(talk, hero, 'hurt', [h(talk, id('cellar'))]);
    expect(result.kind).toBe('failed');
    expect(get(hero, 'stats')?.hp).toBe(20);
    expect(get(hero, 'location')).toEqual({ in: id('hall') });
  });

  test('a Run that writes and completes keeps its writes', async () => {
    const { get, id, talk } = await setup();
    const hero = id('hero');
    talk.loadAtomScript(
      'person',
      `on hurt place
  change the target, "stats", {hp: 1}
  moveTo the target, place
end hurt`
    );
    await ask(talk, hero, 'hurt', [h(talk, id('cellar'))]);
    expect(get(hero, 'stats')).toEqual({ hp: 1, mood: 'calm' });
    expect(get(hero, 'location')).toEqual({ in: id('cellar') });
  });
});

describe('links and Decisions', () => {
  const LINKS = `
atom place { link {} }
entity far: place {}
entity near: place { link { to: $far } }
entity shut: place { link { to: $far locked: true } }
`;

  const PLACE = `on go
  send arrive to the to of the link of the target
end go

on leadsTo place
  return the to of the link of the target is place
end leadsTo

on arrive
  show the target, "arrived"
end arrive

on probe id
  ask world to resolve id
  return it is nothing
end probe

on beforeGo, deciding
  if the locked of the link of the target then veto "locked"
end beforeGo`;

  const links = async () => {
    const built = await buildWorld(LINKS);
    const started = startTalk(built.world);
    started.talk.loadAtomScript('place', PLACE);
    return { ...built, ...started };
  };

  test('deliver to an entity a Script reaches inside a Run', async () => {
    const { id, shown, talk } = await links();
    talk.deliver(id('near'), 'go');
    for (let i = 0; i < 3; i++) {
      talk.pump(now());
    }
    expect(shown).toEqual([[id('far'), 'arrived']]);
  });

  test('give a Script a reference field as the Handle it names', async () => {
    const { id, talk } = await links();
    const far = h(talk, id('far'));
    const near = h(talk, id('near'));
    expect(value(await ask(talk, id('near'), 'leadsTo', [far]))).toBe(true);
    expect(value(await ask(talk, id('near'), 'leadsTo', [near]))).toBe(false);
  });

  test('resolve an id that names no entity to Nothing', async () => {
    const { id, talk } = await links();
    expect(value(await ask(talk, id('near'), 'probe', [num(9999)]))).toBe(true);
  });

  test('answer a Decision with a veto reason', async () => {
    const { id, talk } = await links();
    const open = talk.decide(id('near'), 'beforeGo');
    const shut = talk.decide(id('shut'), 'beforeGo');
    expect(await settle(talk, open)).toEqual({ kind: 'passed' });
    expect(await settle(talk, shut)).toEqual({
      kind: 'vetoed',
      reason: text('locked')
    });
  });
});

describe('the Message Path', () => {
  test("climbs an unhandled message to the base atom's Script", async () => {
    const { id, talk } = await setup();
    talk.loadAtomScript(
      'thing',
      'on describe\n  return "a thing with " & the hp of the stats of the target\nend describe'
    );
    talk.loadAtomScript('person', 'on greet\n  return "hello"\nend greet');
    expect(value(await ask(talk, id('hero'), 'greet'))).toBe('hello');
    expect(value(await ask(talk, id('hero'), 'describe'))).toBe(
      'a thing with 20'
    );
  });

  test('reaches every base Script, rightmost first', async () => {
    const { id, world } = await buildWorld(
      'atom a {}\natom b {}\nentity both: a b {}'
    );
    const { talk } = startTalk(world);
    talk.loadAtomScript(
      'a',
      'on who\n  return "a"\nend who\non onlyA\n  return "from a"\nend onlyA'
    );
    talk.loadAtomScript('b', 'on who\n  return "b"\nend who');
    expect(value(await ask(talk, id('both'), 'who'))).toBe('b');
    expect(value(await ask(talk, id('both'), 'onlyA'))).toBe('from a');
  });

  test('puts a shared ancestor after every atom built on it', async () => {
    const { id, world } = await buildWorld(
      'atom thing {}\natom box: thing {}\natom fragile: thing {}\nentity vase: box fragile {}'
    );
    const { talk } = startTalk(world);
    talk.loadAtomScript(
      'thing',
      'on order\n  return "thing"\nend order\non base\n  return "thing"\nend base'
    );
    talk.loadAtomScript('box', 'on order\n  return "box"\nend order');
    talk.loadAtomScript('fragile', 'on other\n  return 1\nend other');
    expect(value(await ask(talk, id('vase'), 'order'))).toBe('box');
    expect(value(await ask(talk, id('vase'), 'base'))).toBe('thing');
  });

  test('gives an atom a parent for each path it sits on', async () => {
    const { id, world } = await buildWorld(
      'atom a {}\natom b {}\nentity plain: a {}\nentity mixed: b a {}'
    );
    const { talk } = startTalk(world);
    talk.loadAtomScript('a', 'on who\n  pass who\nend who');
    talk.loadAtomScript('b', 'on who\n  return "b"\nend who');
    expect(value(await ask(talk, id('mixed'), 'who'))).toBe('b');
    // nothing above `a` on plain's path handles it
    expect((await ask(talk, id('plain'), 'who')).kind).toBe('passed');
  });

  test("re-links paths when an atom's Script loads later", async () => {
    const { id, world } = await buildWorld(
      'atom a {}\natom b {}\nentity both: a b {}'
    );
    const { talk } = startTalk(world);
    talk.loadAtomScript('b', 'on who\n  return "b"\nend who');
    expect(value(await ask(talk, id('both'), 'who'))).toBe('b');
    talk.loadAtomScript('a', 'on onlyA\n  return "a"\nend onlyA');
    expect(value(await ask(talk, id('both'), 'onlyA'))).toBe('a');
  });

  test('linearizes Lineage', () => {
    const lineage: Record<string, string[]> = {
      box: ['thing'],
      fragile: ['thing'],
      thing: []
    };
    expect(linearize(['box', 'fragile'], a => lineage[a])).toEqual([
      'fragile',
      'box',
      'thing'
    ]);
    expect(linearize(['a', 'b'], () => [])).toEqual(['b', 'a']);
    expect(linearize([], () => [])).toEqual([]);
  });
});

test("a Library calls the world Capability with its caller's Grant", async () => {
  const { id, talk } = await setup();
  talk.addLibrary(
    'weights',
    `function heaviest place
  ask world to find place, "item"
  return the weight of the item of item 1 of it
end heaviest`
  );
  talk.loadAtomScript(
    'person',
    'use heaviest from weights\n\non weigh place\n  return heaviest(place)\nend weigh'
  );
  const weighed = value(
    await ask(talk, id('hero'), 'weigh', [h(talk, id('hall'))])
  );
  expect(String(weighed)).toBe('2.0');
});

test('knows which entities a Script can answer for', async () => {
  const { id, talk } = await setup();
  talk.loadAtomScript('thing', 'on x\n  return 1\nend x');
  talk.loadEntityScript(id('lamp'), 'on x\n  return 1\nend x');
  expect(talk.isScripted(id('hero'))).toBe(true);
  expect(talk.isScripted(id('lamp'))).toBe(true);
  expect(talk.isScripted(id('hall'))).toBe(false);
});

test('a Service Script is reached only by name', async () => {
  const { id, talk } = await setup();
  talk.loadServiceScript(
    'weigher',
    `on weigh thing
  return the hp of the stats of thing
end weigh

on beforeLift thing, deciding
  if the hp of the stats of thing > 15 then
    veto "too heavy"
  end if
end beforeLift`
  );
  const hero = h(talk, id('hero'));
  const weighed = talk.requestService('weigher', 'weigh', [hero], now());
  const lifted = talk.decideService('weigher', 'beforeLift', [hero]);
  expect(value(await settle(talk, weighed))).toBe(20);
  expect((await settle(talk, lifted)).kind).toBe('vetoed');
  expect((await ask(talk, id('hero'), 'weigh', [hero])).kind).toBe('passed');
  expect(() => talk.decideService('nobody', 'x')).toThrow(
    'No Service Script named nobody'
  );
});

const scriptsWorld = async (edl: string, files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'ecs-talk-'));
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(dir, name), source);
  }
  const built = await buildWorld(
    `def script {\n  src: string\n}\n${edl}`,
    join(dir, 'main.edl')
  );
  const read = (path: string) =>
    readFileSync(path.startsWith('/') ? path : join(dir, path), 'utf8');
  return { ...built, read, ...startTalk(built.world) };
};

test('loads the Scripts the EDL declares', async () => {
  const { id, read, talk } = await scriptsWorld(
    'atom person { script { src: "person.talk" } }\nentity hero: person {}\nentity rock { script { src: "rock.talk" } }',
    {
      'person.talk': 'on who\n  return "person"\nend who',
      'rock.talk': 'on who\n  return "rock"\nend who'
    }
  );
  talk.loadScripts(read);
  expect(value(await ask(talk, id('hero'), 'who'))).toBe('person');
  expect(value(await ask(talk, id('rock'), 'who'))).toBe('rock');
});

test('names the Script that fails to load', async () => {
  const { read, talk } = await scriptsWorld(
    'entity rock { script { src: "rock.talk" } }',
    { 'rock.talk': 'on who\n  return (\nend who' }
  );
  let error: unknown;
  try {
    talk.loadScripts(read);
  } catch (error_) {
    error = error_;
  }
  expect(error).toBeInstanceOf(ScriptLoadError);
  expect((error as ScriptLoadError).path).toEndWith('rock.talk');
  expect((error as ScriptLoadError).cause).toBeInstanceOf(LoadError);
});

test("a Service Script's code can be replaced, keeping its Grants", async () => {
  const { get, id, talk } = await setup();
  const hero = h(talk, id('hero'));
  talk.putServiceScript('probe', 'on run who\n  return 1\nend run');
  talk.putServiceScript(
    'probe',
    'on run who\n  change who, "stats", {hp: 7}\n  return 2\nend run'
  );
  expect(
    value(
      await settle(talk, talk.requestService('probe', 'run', [hero], now()))
    )
  ).toBe(2);
  expect(get(id('hero'), 'stats')?.hp).toBe(7);

  expect(() =>
    talk.putServiceScript('probe', 'on run\n  return (\nend run')
  ).toThrow(LoadError);
  expect(
    value(
      await settle(talk, talk.requestService('probe', 'run', [hero], now()))
    )
  ).toBe(2);
});

test('a change keeps a Handle inside a map as its entity', async () => {
  const { get, id, talk } = await setup();
  talk.putServiceScript(
    'probe',
    'on run who, place\n  change who, "location", {in: place}\nend run'
  );
  await settle(
    talk,
    talk.requestService(
      'probe',
      'run',
      [h(talk, id('hero')), h(talk, id('cellar'))],
      now()
    )
  );
  expect(get(id('hero'), 'location')).toEqual({ in: id('cellar') });
});

test('a Service Script that fails to load can be loaded again', async () => {
  const { id, talk } = await setup();
  const hero = h(talk, id('hero'));
  expect(() =>
    talk.putServiceScript('probe', 'on run\n  return (\nend run')
  ).toThrow(LoadError);
  talk.putServiceScript('probe', 'on run who\n  return 1\nend run');
  expect(
    value(
      await settle(talk, talk.requestService('probe', 'run', [hero], now()))
    )
  ).toBe(1);
});

// `probe` answers the host term of the Run's Delivery, and its receiver
const probeCapability = (talk: EcsTalk) =>
  defineCapability('probe', {
    host: {
      args: [],
      cost: { fuel: 1 },
      do: (call): Value => {
        const entry = talk.delivery(call);
        return entry?.host === undefined
          ? nothing
          : text(`${String(entry.host)} for ${entry.receiver}`);
      },
      mode: 'immediate'
    }
  });

const entry = (talk: Talk, delivery: string) => talk.delivery({ delivery });

const idle = (talk: Talk, pending: Pending, ms = 0) => {
  talk.pumpUntilIdle(now(ms));
  return outcome(pending);
};

describe("a Delivery's host term", () => {
  // `probe` answers the host term of the Run's Delivery, and its receiver
  const PROBE = `on peek
  ask probe to host
  if it is nothing then
    show the target, "nothing"
  else
    show the target, it
  end if
end peek

on linger
  wait 2 s
  ask probe to host
  show the target, it
end linger

on query
  ask probe to host
  return it
end query

on judge, deciding
  ask probe to host
  veto it
end judge`;

  const probed = async () => {
    const built = await buildWorld(EDL);
    const started = startTalk(built.world, { capabilities: [probeCapability] });
    started.talk.loadAtomScript('person', PROBE);
    return { ...started, hero: built.id('hero') };
  };

  test('is seen by a Capability in the Run, and freed once its work ends', async () => {
    const { hero, shown, talk } = await probed();
    const id = talk.deliver(hero, 'peek', [], { host: 'look' });
    expect(entry(talk, id)).toEqual({ host: 'look', receiver: hero });
    talk.pump(now());
    expect(shown).toEqual([[hero, `look for ${hero}`]]);
    expect(entry(talk, id)).toBeUndefined();
  });

  test('is kept while a Run waits', async () => {
    const { hero, shown, talk } = await probed();
    const id = talk.deliver(hero, 'linger', [], { host: 'wait' });
    talk.pump(now());
    talk.pump(now(1000));
    expect(entry(talk, id)).toEqual({ host: 'wait', receiver: hero });
    talk.pump(now(3000));
    expect(shown).toEqual([[hero, `wait for ${hero}`]]);
    expect(entry(talk, id)).toBeUndefined();
  });

  test("is seen by a Request's Run in its first Pump", async () => {
    const { hero, talk } = await probed();
    const pending = talk.request(hero, 'query', [], now(), { host: 'ask' });
    expect(value(await settle(talk, pending))).toBe(`ask for ${hero}`);
    expect(entry(talk, pending.delivery)).toBeUndefined();
  });

  test("is seen by a Decision's Run", async () => {
    const { hero, talk } = await probed();
    const pending = talk.decide(hero, 'judge', [], { host: 'vote' });
    expect(await settle(talk, pending)).toEqual({
      kind: 'vetoed',
      reason: text(`vote for ${hero}`)
    });
  });

  test('is Nothing for a Delivery sent without one', async () => {
    const { hero, shown, talk } = await probed();
    talk.deliver(hero, 'peek');
    talk.pump(now());
    expect(shown).toEqual([[hero, 'nothing']]);
    expect(value(await ask(talk, hero, 'query'))).toBe(null);
  });
});

describe('outcomes', () => {
  const OUTCOMES = `on greet
  return "hello"
end greet

on enrage
  change the target, "stats", {hp: "lots"}
end enrage

on linger
  wait 2 s
  return "late"
end linger

on beforeGo, deciding
  veto "locked"
end beforeGo`;

  const outcomes = async () => {
    const { id, talk } = await setup();
    talk.loadAtomScript('person', OUTCOMES);
    return { hero: id('hero'), talk };
  };

  test('a Handler that returns has replied', async () => {
    const { hero, talk } = await outcomes();
    const pending = talk.request(hero, 'greet', [], now());
    expect(await idle(talk, pending)).toEqual({
      kind: 'replied',
      value: text('hello')
    });
  });

  test('a message nobody handles, or a Decision allowed, has passed', async () => {
    const { hero, talk } = await outcomes();
    const unhandled = talk.request(hero, 'dance', [], now());
    const allowed = talk.decide(hero, 'beforeSit');
    expect(await idle(talk, unhandled)).toEqual({ kind: 'passed' });
    expect(await idle(talk, allowed)).toEqual({ kind: 'passed' });
  });

  test('a Decision vetoed gives its reason', async () => {
    const { hero, talk } = await outcomes();
    expect(await idle(talk, talk.decide(hero, 'beforeGo'))).toEqual({
      kind: 'vetoed',
      reason: text('locked')
    });
  });

  test('a Run that fails gives its error', async () => {
    const { hero, talk } = await outcomes();
    const result = await idle(talk, talk.request(hero, 'enrage', [], now()));
    expect(result.kind === 'failed' && result.error).toBeInstanceOf(
      ScriptError
    );
  });

  test('a Run still waiting once idle is waiting, and replies in a later Pump', async () => {
    const { hero, talk } = await outcomes();
    const pending = talk.request(hero, 'linger', [], now());
    expect(talk.pumpUntilIdle(now())).toBe(now(2000));
    expect(await outcome(pending)).toEqual({ kind: 'waiting' });
    expect(await idle(talk, pending, 2000)).toEqual({
      kind: 'replied',
      value: text('late')
    });
  });

  test('pumps again while `between` sends more work', async () => {
    const { hero, talk } = await outcomes();
    let left = 2;
    talk.deliver(hero, 'greet');
    const between = () => {
      if (left === 0) {
        return false;
      }
      left -= 1;
      return true;
    };
    expect(talk.pumpUntilIdle(now(), { between })).toBeUndefined();
    expect(left).toBe(0);
  });

  test('asking again once settled is an error', async () => {
    const { hero, talk } = await outcomes();
    const pending = talk.request(hero, 'greet', [], now());
    await idle(talk, pending);
    expect(outcome(pending)).rejects.toThrow('released');
  });
});

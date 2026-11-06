import {
  createEngine,
  instantUs,
  removeTimer,
  timerCapability,
  type Step,
  type Timer
} from 'ecs-engine';
import { createEcsTalk, outcome, type Outcome, type Pending } from 'ecs-talk';
import {
  armSystems,
  exists,
  get,
  put,
  query,
  type Data,
  type Eid,
  type Store,
  type System
} from 'odgn-ecs/store';
import type { Components } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { Limits } from '@northtalk/ts';

import type { BoundCommand } from '../commands/bind';
import { location } from '../commands/scope';
import { fromWorld } from '../commands/verbs';
import { expand } from '../exits';
import { read, readNpc } from '../input';
import {
  CANNOT,
  SERVICE_NAMES,
  afters,
  plan,
  questions,
  type Context,
  type Question
} from './dispatch';
import { TIMERS_SCRIPT, armLifecycle, rearm, recordHomes } from './lifecycle';
import { destination, ensurePlaces } from './places';
import {
  abandonWaiting,
  deleteAct,
  ensureMuaTables,
  output,
  queuedActs,
  takeNotices,
  takeOutbox,
  tell,
  type Act
} from './tables';
import { argValue, between, muaCapability, type Notices } from './talk';

/** mua's Libraries, by the name Scripts `use` them from */
const LIBRARIES = ['things', 'messages', 'rooms'];

export type MuaWorldOptions = {
  /** Milliseconds of wall time, for World time; `performance.now` by default */
  clock?: () => number;
  /** Limits for every Script */
  limits?: Partial<Limits>;
  /** Reads a Script's source, by its path */
  readFile: (path: string) => string;
  /** Where `packages/mua-scripts` is, for mua's Libraries and Services */
  scriptsDir: string;
  /** The Definition name of the room Characters enter when they have nowhere to return to */
  startingRoom: string;
};

/** What a command came to: `done` when it acted, `refused` when it was answered with a no */
type Result = { kind: 'done' | 'refused'; message: string };

type Reply =
  | { kind: 'failed' }
  | { kind: 'passed' }
  | { kind: 'refused'; message: string }
  | { kind: 'replied'; message: string | null };

type K = (s: Step, result: Result) => unknown;

const NAME = /^[A-Za-z][\d 'A-Za-z-]{0,19}$/;

/** Why a call to the World was refused, as `MuaWorld`'s error atoms */
export class MuaWorldError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MuaWorldError';
  }
}

const idOf = (v: unknown) => (typeof v === 'number' ? v : null);
const textOf = (v: unknown) => (typeof v === 'string' ? v : null);

/** A command an NPC's Script gave already bound, as `MuaWorld.Input.bound/1` reads it */
const asBound = (act: Record<string, unknown>): BoundCommand | null => {
  if (typeof act.verb !== 'string' || act.verb === '') {
    return null;
  }
  return {
    direction: textOf(act.direction),
    indirectId: idOf(act.indirect),
    label: null,
    targetId: idOf(act.target),
    text: textOf(act.text),
    verb: act.verb
  } as BoundCommand;
};

const done = (message: string | null): Result => ({
  kind: 'done',
  message: message ?? ''
});

const refused = (message: string): Result => ({ kind: 'refused', message });

/**
 * A question's outcome as Dispatch reads it: a Decision's veto is its
 * answer, as a reply is a Request's. A Request says no by replying
 * `{refused: text}`; any other map is a mistake, so fails.
 */
const replyOf = (q: Question, o: Outcome): Reply => {
  if (q.asks === 'offer' && o.kind === 'replied') {
    const v = o.value;
    if (v.kind === 'map') {
      const text = v.hasKey('refused') ? v.get('refused').asText() : undefined;
      return text === undefined
        ? { kind: 'failed' }
        : { kind: 'refused', message: text };
    }
    return { kind: 'replied', message: v.asText() ?? null };
  }
  if (q.asks === 'decide' && o.kind === 'vetoed') {
    return { kind: 'replied', message: o.reason?.asText() ?? null };
  }
  return o.kind === 'passed' ? { kind: 'passed' } : { kind: 'failed' };
};

/**
 * One mua World, the TypeScript Host that `MuaWorld` is in Elixir (ADR
 * 0023): it owns the World's store and NorthTalk, and orders every change
 * to it. Each input is one Step of an `ecs-engine`. Output goes to the
 * outbox inside the Step's transaction, and reaches subscribers after its
 * commit (ADR 0012). Calls run one at a time, as messages to a process do.
 *
 * The World must already be built from its EDL, with mua's components.
 * World time advances with `clock` while the World runs, and `tick` runs
 * what is due. Admin lines, sign-in identities and backups are the
 * server's, so they aren't here.
 */
export const startMuaWorld = async (
  world: World<Components>,
  options: MuaWorldOptions
) => {
  const store: Store = world.store;
  const clock = options.clock ?? (() => performance.now());
  const notices: Notices = [];
  const subscribers = new Map<Eid, Set<(text: string) => void>>();
  const named = (name: string) => world.getDefinitionNames().get(name);
  const mua = (path: string) =>
    options.readFile(`${options.scriptsDir}/scripts/${path}`);

  // -- Start ----------------------------------------------------------------

  store.db.exec('BEGIN IMMEDIATE');
  let places;
  try {
    ensureMuaTables(store);
    expand(store);
    abandonWaiting(store);
    places = ensurePlaces(store, options.startingRoom, named);
    recordHomes(store);
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  const { limbo, system } = places;
  const vocabulary = fromWorld(store);

  const talk = createEcsTalk(world, {
    capabilities: [timerCapability(store), muaCapability(store, notices)],
    limits: options.limits,
    onShow: (eid, line) => tell(store, eid, line)
  });
  for (const name of LIBRARIES) {
    talk.addLibrary(name, mua(`lib/${name}.talk`));
  }
  for (const name of SERVICE_NAMES) {
    talk.loadServiceScript(name, mua(`services/${name}.talk`));
  }
  talk.loadScripts(options.readFile);

  const systemValue = () => talk.handle(system).value;

  const systems: System<Step>[] = [
    // Every active NPC gets `heartbeat`, for its Scripts to act on
    {
      every: 45_000,
      name: 'npc_heartbeat',
      query: { where: [['npc', 'active', true]] },
      run: (npcs, step) => {
        for (const npc of npcs as Eid[]) {
          if (talk.isScripted(npc)) {
            step.deliver({
              args: [systemValue()],
              message: 'heartbeat',
              to: npc
            });
          }
        }
      }
    }
  ];

  // -- Timers and resets ----------------------------------------------------

  // What a reset does is the lifecycle Service's to decide (ADR 0024); the
  // place's own Scripts hear of it after
  const resetPlace = async (s: Step, place: Eid) => {
    const pending = s.deliver({
      args: [talk.handle(place).value],
      asks: 'request',
      message: 'reset',
      to: { service: 'lifecycle' }
    }) as Pending;
    s.pump();
    const o = await outcome(pending);
    const moved = o.kind === 'replied' ? Number(o.value.toString()) || 0 : 0;
    if (talk.isScripted(place)) {
      talk.deliver(place, 'reset', [systemValue()]);
    }
    return Math.trunc(moved);
  };

  // mua's own `timers`: `reset` resets the place; any other message goes
  // to the entity's Scripts from the system actor
  const fireLifecycle = async (s: Step, timer: Timer) => {
    removeTimer(store, timer);
    if (exists(store, timer.owner)) {
      if (timer.message === 'reset') {
        await resetPlace(s, timer.owner);
      } else if (talk.isScripted(timer.owner)) {
        talk.deliver(timer.owner, timer.message, [systemValue()]);
      }
    }
    rearm(store, timer, instantUs(s.now));
  };

  // -- The engine -----------------------------------------------------------

  const engine = createEngine(store, talk, {
    between: between(talk, store, notices),
    onStep: result => {
      if (!result.ok) {
        // notices queued by the Step's Scripts went with it
        notices.length = 0;
        return;
      }
      for (const [character, line] of result.output.output as [Eid, string][]) {
        for (const fn of subscribers.get(character) ?? []) {
          fn(line);
        }
      }
    },
    output: () => takeOutbox(store),
    systems,
    timers: { [TIMERS_SCRIPT]: fireLifecycle }
  });

  // The World keeps the clock, and gives the engine World time
  let worldMs = engine.worldTime;
  let readAt = clock();
  const advanceClock = () => {
    const now = clock();
    worldMs += now - readAt;
    readAt = now;
  };

  const step = <R>(input: (s: Step) => Promise<R> | R) =>
    engine.step(input, { at: Math.floor(worldMs) });

  // -- Dispatch -------------------------------------------------------------

  const answerable = (to: Question['to']) =>
    typeof to === 'object' || talk.isScripted(to);

  /**
   * Sends one question, Pumps until idle, and answers `k` now or, if its
   * Run is still waiting, in the Step that sees it end: a Waiting input
   */
  const ask = (
    s: Step,
    ctx: Context,
    q: Question,
    k: (s: Step, reply: Reply) => unknown
  ) =>
    s.ask(
      {
        args: q.args.map(a => argValue(talk, a)),
        asks: q.asks === 'offer' ? 'request' : 'decide',
        host: ctx,
        message: q.message,
        to: q.to
      },
      { actor: ctx.actor, input: ctx.raw },
      (next, o) => k(next, replyOf(q, o))
    );

  // Once an action has succeeded, `after<Verb>` goes to the same receivers,
  // whose replies are added to its message
  const afterEach = (
    s: Step,
    ctx: Context,
    qs: Question[],
    result: Result,
    k: K
  ): unknown => {
    const [q, ...rest] = qs;
    if (!q || result.kind !== 'done') {
      return k(s, result);
    }
    if (!answerable(q.to)) {
      return afterEach(s, ctx, rest, result, k);
    }
    return ask(s, ctx, q, (next, reply) => {
      const line = reply.kind === 'replied' ? reply.message : null;
      const joined = line
        ? {
            ...result,
            message: [result.message, line].filter(Boolean).join('\n')
          }
        : result;
      return afterEach(next, ctx, rest, joined, k);
    });
  };

  const runAction = (s: Step, ctx: Context, k: K) => {
    const p = plan(store, ctx);
    if (p.kind === 'refused') {
      return k(s, refused(p.message));
    }
    const q: Question = { ...p, asks: 'offer', kind: 'action' };
    return ask(s, ctx, q, (next, reply) => {
      switch (reply.kind) {
        case 'replied':
          return afterEach(
            next,
            ctx,
            afters(store, ctx),
            done(reply.message),
            k
          );
        case 'refused':
          return k(next, refused(reply.message));
        case 'failed':
          return k(next, refused('Something went wrong.'));
        default:
          return k(next, refused(CANNOT));
      }
    });
  };

  // The receivers and veto Decisions in turn, then the Action
  const askEach = (s: Step, ctx: Context, qs: Question[], k: K): unknown => {
    const [q, ...rest] = qs;
    if (!q) {
      return runAction(s, ctx, k);
    }
    if (!answerable(q.to)) {
      return askEach(s, ctx, rest, k);
    }
    return ask(s, ctx, q, (next, reply) => {
      switch (reply.kind) {
        case 'replied':
          return q.kind === 'receiver'
            ? k(next, done(reply.message))
            : k(next, refused(reply.message ?? CANNOT));
        case 'refused':
          return k(next, refused(reply.message));
        case 'failed':
          return k(next, refused('Something went wrong.'));
        default:
          return askEach(next, ctx, rest, k);
      }
    });
  };

  const runCommands = (
    s: Step,
    actor: Eid,
    commands: readonly BoundCommand[],
    raw: string
  ): unknown => {
    const [command, ...rest] = commands;
    if (!command) {
      return undefined;
    }
    const ctx: Context = {
      actor,
      direction: command.direction ?? null,
      indirectId: command.indirectId,
      raw,
      targetId: command.targetId,
      text: command.text ?? null,
      verb: command.verb,
      vocabulary
    };
    return askEach(s, ctx, questions(store, ctx), (next, result) => {
      // Tells the actor; everyone else was told by the Service Script
      if (result.message) {
        output(
          store,
          actor,
          command.label ? `${command.label}: ${result.message}` : result.message
        );
      }
      return runCommands(next, actor, rest, raw);
    });
  };

  /** A Character's input: read into commands, which run in turn */
  const input = (s: Step, actor: Eid, line: string) => {
    const [result, changes] = read(store, vocabulary, actor, line);
    if (Object.keys(changes).length > 0) {
      put(store, actor, 'player', {
        ...get(store, actor, 'player'),
        ...changes
      });
    }
    if (result.kind === 'reply') {
      output(store, actor, result.message);
      return undefined;
    }
    return runCommands(s, actor, result.commands, line);
  };

  // -- NPCs -----------------------------------------------------------------

  // A bound command skips the parser (ADR 0024)
  const npcInput = (s: Step, actor: Eid, act: Act) => {
    if (get(store, actor, 'npc')?.active !== true) {
      return undefined;
    }
    if (typeof act === 'string') {
      const commands = readNpc(store, vocabulary, actor, act);
      return commands ? runCommands(s, actor, commands, act) : undefined;
    }
    const bound = asBound(act);
    return bound ? runCommands(s, actor, [bound], bound.verb) : undefined;
  };

  // The NPC commands queued so far, each a Step of its own. Any they queue
  // wait for the next run, so an NPC answering itself can't loop.
  const runNpcs = async () => {
    for (const { act, actor, id } of queuedActs(store)) {
      await step(s => {
        deleteAct(store, id);
        return npcInput(s, actor, act);
      });
    }
  };

  // -- Calls ----------------------------------------------------------------

  // Calls run one at a time
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };

  /** Runs `input` as one Step for a Character, returning what it was told */
  const linesFor = async (character: Eid, input_: (s: Step) => unknown) => {
    const result = await step(input_);
    await runNpcs();
    if (!result.ok) {
      throw new MuaWorldError('step_failed');
    }
    return (result.output.output as [Eid, string][])
      .filter(([c]) => c === character)
      .map(([, line]) => line);
  };

  const resultOf = async <R>(input_: (s: Step) => Promise<R> | R) => {
    const result = await step(input_);
    if (!result.ok) {
      throw new MuaWorldError('step_failed');
    }
    return result.output.result;
  };

  const owns = (account: Eid, character: Eid) => {
    if (get(store, character, 'player')?.account !== account) {
      throw new MuaWorldError('not_owner');
    }
  };

  // A Character in Limbo returns to the room it left, if that is still a
  // place, otherwise to the Starting room, and is welcomed. One already in
  // play carries on without a fresh greeting.
  const enterPlay = (character: Eid) => {
    const player: Data = get(store, character, 'player')!;
    if (location(store, character) !== limbo) {
      return;
    }
    const room = destination(store, character, places);
    put(store, character, 'location', { in: room });
    put(store, character, 'player', { ...player, return_to: null });
    if (player.return_to != null) {
      tell(store, room, `${String(player.name)} appears.`, character);
    }
    output(
      store,
      character,
      `Welcome, ${String(player.name)}! Type 'look' to begin, or 'help' for the commands.`
    );
  };

  // A Character who leaves waits in Limbo, and remembers the room it left
  const leavePlay = (character: Eid) => {
    const room = location(store, character);
    if (room === null || room === limbo) {
      return;
    }
    const player: Data = get(store, character, 'player')!;
    put(store, character, 'player', { ...player, return_to: room });
    put(store, character, 'location', { in: limbo });
    tell(store, room, `${String(player.name)} fades from view.`);
  };

  // Arms mua's timers and Systems, then tells every scripted thing the
  // World has started, as one Step
  await step(s => {
    armLifecycle(store, instantUs(s.now));
    armSystems(store, systems, s.now);
    for (const eid of query(store, { with: ['described'] })) {
      if (talk.isScripted(eid)) {
        talk.deliver(eid, 'start', [systemValue()]);
      }
    }
  });

  return {
    /** Moves World time on by `ms`, for tests that don't want to wait */
    advance: (ms: number) =>
      serial(() => {
        worldMs += ms;
      }),

    /** The Characters an Account owns */
    characters: (account: Eid) =>
      serial(() =>
        query(store, { where: [['player', 'account', account]] }).map(eid => ({
          id: eid,
          inPlay: location(store, eid) !== limbo,
          name: get(store, eid, 'player')!.name as string
        }))
      ),

    /** Runs one command for a Character as one Step, returning what it was told */
    command: (account: Eid, character: Eid, line: string) =>
      serial(() => {
        owns(account, character);
        if (location(store, character) === limbo) {
          throw new MuaWorldError('not_in_play');
        }
        advanceClock();
        return linesFor(character, s => input(s, character, line.trim()));
      }),

    /** Reads a component */
    component: (eid: Eid, name: string) => serial(() => get(store, eid, name)),

    /** Makes an Account, as one Step, and returns its id */
    createAccount: () =>
      serial(() =>
        resultOf(() => {
          const eid = store.db.addEntity();
          put(store, eid, 'account', {});
          return eid;
        })
      ),

    /**
     * Makes a Character for an Account, with a public name, as one Step.
     * It waits in Limbo until it enters. Names are unique, ignoring case.
     */
    createCharacter: (account: Eid, rawName: string) =>
      serial(() => {
        const name = rawName.trim();
        if (!get(store, account, 'account')) {
          throw new MuaWorldError('not_an_account');
        }
        if (!NAME.test(name)) {
          throw new MuaWorldError('invalid_name');
        }
        if (query(store, { where: [['player', 'name', name]] }).length > 0) {
          throw new MuaWorldError('name_taken');
        }
        return resultOf(() => {
          const eid = store.db.addEntity();
          put(store, eid, 'player', { account, name });
          put(store, eid, 'meta', { props: { id: name.toLowerCase() } });
          put(store, eid, 'location', { in: limbo });
          talk.handle(eid);
          return eid;
        });
      }),

    /**
     * Brings a Character into play from Limbo, as one Step, and returns
     * what it was told: a welcome, or nothing if it was in play already
     */
    enter: (account: Eid, character: Eid) =>
      serial(() => {
        owns(account, character);
        advanceClock();
        return linesFor(character, () => enterPlay(character));
      }),

    /** Takes a Character out of play, into Limbo, as one Step */
    leave: (account: Eid, character: Eid) =>
      serial(async () => {
        owns(account, character);
        advanceClock();
        await linesFor(character, () => leavePlay(character));
      }),

    /** The entity with this Definition name */
    named: (name: string) => serial(() => named(name)),

    /** Limbo, the system actor and the Starting room */
    places,

    /**
     * Resets a place, as its `reset` timer does, as one Step: puts back
     * what has strayed from it, unless a Character carries it, and tells
     * its Scripts. Returns how many things moved.
     */
    reset: (place: Eid) =>
      serial(() => {
        advanceClock();
        return resultOf(s => resetPlace(s, place));
      }),

    store,

    /**
     * Calls `fn` with each line of the Character's output from now on,
     * after any notices left from before a restart. Returns a function
     * that stops it.
     */
    subscribe: (character: Eid, fn: (text: string) => void) =>
      serial(() => {
        store.db.exec('BEGIN IMMEDIATE');
        const left = takeNotices(store, character);
        store.db.exec('COMMIT');
        for (const line of left) {
          fn(line);
        }
        const set = subscribers.get(character) ?? new Set();
        set.add(fn);
        subscribers.set(character, set);
        return () => {
          set.delete(fn);
        };
      }),

    /** Advances World time and runs what is due, then the NPCs' commands */
    tick: () =>
      serial(async () => {
        advanceClock();
        await engine.advance(Math.floor(worldMs));
        await runNpcs();
      }),

    /** World time, in milliseconds */
    worldTime: () =>
      serial(() => {
        advanceClock();
        return Math.floor(worldMs);
      })
  };
};

export type MuaWorld = Awaited<ReturnType<typeof startMuaWorld>>;

import {
  abandon,
  outcome,
  type EcsTalk,
  type Outcome,
  type Pending
} from 'ecs-talk';
import {
  dueSystems,
  nextDue,
  runSystem,
  takeChanges,
  type ChangeSetEntry,
  type Eid,
  type Store,
  type System
} from 'odgn-ecs/store';

import type { Value } from '@northtalk/ts';

import {
  deleteWaiting,
  ensureTables,
  insertWaiting,
  putWorldTime,
  storedWorldTime
} from './tables';
import { dueTimers, fireTimer, nextTimerAt, type Timer } from './timers';

/** World time 0, 2000-01-01T00:00:00Z, in microseconds since the Unix epoch */
export const EPOCH_US = 946_684_800_000_000;

/** World time `ms` as microseconds since the Unix epoch, as timers keep it */
export const instantUs = (ms: number) => EPOCH_US + ms * 1000;

/** World time `ms` as NorthTalk's Clock reads it */
const clock = (ms: number) => BigInt(instantUs(ms));

/**
 * One message handed to an entity's Message Path, or to a Service Script,
 * from outside Scripts, as `OdgnEcsEngine.Delivery`. `asks` is `deliver`
 * (the default), `request` or `decide`; a Service Script can only be asked.
 * `host` is a term the Delivery's Capability calls see.
 */
export type Delivery = {
  args?: readonly Value[];
  asks?: 'decide' | 'deliver' | 'request';
  host?: unknown;
  message: string;
  to: Eid | { service: string };
};

/** What a restart reports abandoned, for an input left waiting */
export type Waiting = { actor?: Eid; input: string };

type Continuation = (step: Step, outcome: Outcome) => unknown;

type WaitingEntry = {
  actor?: Eid;
  input: string;
  pending: Pending;
  row: number | undefined;
  then: Continuation;
};

/**
 * The handle a Host's input gets while its Step runs, as
 * `OdgnEcsEngine.Step`. It is good only for the Step it was given in.
 */
export type Step = {
  /** Asks a Request or Decision; see `Engine` */
  ask: (
    delivery: Delivery,
    waiting: Waiting,
    then: Continuation
  ) => Promise<unknown>;
  /** Sends a Delivery in this Step */
  deliver: (delivery: Delivery) => Pending | string;
  /** The Step's World time, in milliseconds */
  now: number;
  /** Pumps until the Group is idle */
  pump: () => void;
  store: Store;
  talk: EcsTalk;
};

/** What `step` gives the hook after a commit */
export type StepOutput<R = unknown> = {
  changes: ChangeSetEntry[];
  output: unknown;
  result: R;
  world_time: number;
};

export type StepResult<R = unknown> =
  { ok: true; output: StepOutput<R> } | { error: unknown; ok: false };

export type Input<R = unknown> =
  readonly Delivery[] | ((step: Step) => Promise<R> | R);

export type EngineOptions = {
  /** Called after each Pump; returns whether it sent more work */
  between?: () => boolean;
  /** Called with each Step's result, after its commit or rollback */
  onStep?: (result: StepResult) => void;
  /** Called inside the Step's transaction just before its commit */
  output?: () => unknown;
  /** The Systems to run; each runs with the Step handle as its context */
  systems?: readonly System<Step>[];
  /**
   * The Host's own timers, by the script name it stored them under; each
   * due one is given to its handler instead of being delivered, and is the
   * Host's to remove
   */
  timers?: Readonly<Record<string, (step: Step, timer: Timer) => unknown>>;
  /** World time to start at, in milliseconds; by default the World's */
  worldTime?: number;
};

const runInput = async <R>(step: Step, input: Input<R>) => {
  if (typeof input === 'function') {
    return await input(step);
  }
  for (const d of input) {
    step.deliver(d);
  }
  return undefined as R;
};

/**
 * The engine above the store (ADRs 0018 and 0021), the TypeScript twin of
 * `odgn_ecs_engine`: Steps, Deliveries, Waiting inputs, World time, timers
 * and runs of Systems, for a World whose Scripts run through `ecs-talk`. It
 * keeps no clock: the Host gives it World time, and calls it from the one
 * place that writes the World (ADR 0011).
 *
 * - `step` runs one input as one Step: begin, the input, Pumps until the
 *   Group is idle, the Waiting inputs it settles, then one `COMMIT`. If the
 *   input throws or a listed Delivery can't be sent, the whole Step rolls
 *   back, and inputs already waiting carry on.
 * - `advance` moves World time on and runs, each as its own Step: the due
 *   timers, earliest first; one Step for NorthTalk if its deadline has
 *   come; then the due Systems, in the order given.
 * - `nextDeadline` says when `advance` next has work.
 * - The `onStep` hook gets each Step's result.
 *
 * Unlike Elixir's, a Step returns a promise, since NorthTalk's TypeScript
 * Core settles Requests as promises (see `ecs-talk`'s README).
 */
export const createEngine = (
  store: Store,
  talk: EcsTalk,
  options: EngineOptions = {}
) => {
  ensureTables(store);
  const systems = options.systems ?? [];
  const handlers = options.timers ?? {};
  const between = options.between ?? (() => false);
  let worldTime = options.worldTime ?? storedWorldTime(store);
  /** NorthTalk's next deadline, in World time */
  let deadline: number | undefined;
  const waiting = new Map<number, WaitingEntry>();
  let nextKey = 0;

  const deliver = (now: number, d: Delivery): Pending | string => {
    const args = d.args ?? [];
    const send = { host: d.host };
    const asks = d.asks ?? 'deliver';
    if (typeof d.to === 'object') {
      const { service } = d.to;
      switch (asks) {
        case 'request':
          return talk.requestService(
            service,
            d.message,
            args,
            clock(now),
            send
          );
        case 'decide':
          return talk.decideService(service, d.message, args, send);
        default:
          throw new Error(`A Service Script can only be asked: ${service}`);
      }
    }
    switch (asks) {
      case 'request':
        return talk.request(d.to, d.message, args, clock(now), send);
      case 'decide':
        return talk.decide(d.to, d.message, args, send);
      default:
        return talk.deliver(d.to, d.message, args, send);
    }
  };

  const pump = (now: number) => {
    const next = talk.pumpUntilIdle(clock(now), { between });
    deadline =
      next === undefined
        ? undefined
        : Math.floor((Number(next) - EPOCH_US) / 1000);
  };

  const handle = (now: number): Step => {
    const step: Step = {
      ask: async (d, wait, then) => {
        const pending = deliver(now, d) as Pending;
        pump(now);
        const result = await outcome(pending);
        if (result.kind === 'waiting') {
          waiting.set(nextKey++, {
            actor: wait.actor,
            input: wait.input,
            pending,
            row: undefined,
            then
          });
          return 'waiting';
        }
        return then(step, result);
      },
      deliver: d => deliver(now, d),
      now,
      pump: () => pump(now),
      store,
      talk
    };
    return step;
  };

  // Every input still waiting whose Run has now ended gets its outcome, in
  // this Step; any still waiting keeps or gains its row. Inputs that start
  // waiting in a continuation are seen by the next Step.
  const settleWaiting = async (step: Step) => {
    // a snapshot: inputs that start waiting in a continuation wait for the
    // next Step
    for (const [key, w] of new Map(waiting)) {
      const result = await outcome(w.pending);
      if (result.kind === 'waiting') {
        w.row ??= insertWaiting(store, w.actor, w.input);
      } else {
        if (w.row !== undefined) {
          deleteWaiting(store, w.row);
        }
        waiting.delete(key);
        await w.then(step, result);
      }
    }
  };

  // After a rollback the inputs waiting before the Step carry on. Any that
  // started waiting in it are dropped with its work; any it settled had
  // their answer, whose work is gone, so their rows go too.
  const restoreWaiting = (before: Map<number, WaitingEntry>) => {
    for (const [key, w] of waiting) {
      if (!before.has(key)) {
        abandon(w.pending);
        waiting.delete(key);
      }
    }
    for (const [key, w] of before) {
      if (waiting.has(key)) {
        waiting.set(key, w);
      } else if (w.row !== undefined) {
        deleteWaiting(store, w.row);
      }
    }
  };

  /**
   * Runs `input` as one Step. Option `at` moves World time to that many
   * milliseconds first, without running what is due.
   */
  const step = async <R = unknown>(
    input: Input<R>,
    stepOptions: { at?: number } = {}
  ): Promise<StepResult<R>> => {
    if (stepOptions.at !== undefined) {
      worldTime = stepOptions.at;
    }
    const now = worldTime;
    store.db.exec('BEGIN IMMEDIATE');
    // Changes made since the last Step, outside one, are not this Step's
    takeChanges(store);
    putWorldTime(store, now);
    const before = new Map(
      [...waiting].map(([key, w]) => [key, { ...w }] as const)
    );
    const h = handle(now);

    let result: StepResult<R>;
    try {
      const value = await runInput(h, input);
      pump(now);
      await settleWaiting(h);
      putWorldTime(store, now);
      const output = options.output?.();
      store.db.exec('COMMIT');
      result = {
        ok: true,
        output: {
          changes: takeChanges(store),
          output,
          result: value,
          world_time: now
        }
      };
    } catch (error) {
      store.db.exec('ROLLBACK');
      takeChanges(store);
      restoreWaiting(before);
      result = { error, ok: false };
    }
    options.onStep?.(result);
    return result;
  };

  const fire = (s: Step, timer: Timer) => {
    const handler = handlers[timer.script];
    return handler ? handler(s, timer) : fireTimer(talk, store, timer);
  };

  /**
   * Moves World time to `ms` and runs what is due, each as its own Step.
   * World time is kept even when nothing is due.
   */
  const advance = async (ms: number) => {
    worldTime = ms;
    putWorldTime(store, ms);
    for (const timer of dueTimers(store, instantUs(ms))) {
      await step(s => fire(s, timer));
    }
    if (deadline !== undefined && deadline <= ms) {
      await step(() => undefined);
    }
    for (const system of dueSystems(store, systems, ms)) {
      await step(s => runSystem(store, system, s.now, s));
    }
  };

  /**
   * The earliest World time, in milliseconds, at which `advance` has work:
   * a timer, NorthTalk's deadline or a System. Undefined when nothing waits
   * on time.
   */
  const nextDeadline = (): number | undefined => {
    const at = nextTimerAt(store);
    const times = [
      at === undefined ? undefined : Math.ceil((at - EPOCH_US) / 1000),
      deadline,
      nextDue(store, systems)
    ].filter(t => t !== undefined);
    return times.length === 0 ? undefined : Math.min(...times);
  };

  return {
    advance,
    nextDeadline,
    step,
    store,
    talk,
    /** World time, in milliseconds, as the Host last gave it */
    get worldTime() {
      return worldTime;
    }
  };
};

export type Engine = ReturnType<typeof createEngine>;

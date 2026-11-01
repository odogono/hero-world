import type { EcsTalk } from 'ecs-talk';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import { text } from '@northtalk/ts';

import type { MuaComponents } from '../coms';
import type { CommandContext, CommandContexts } from './commands';

const log = createLog('scripts');

/** How a Script answered a command it was offered */
export type ScriptReply =
  | { kind: 'failed' }
  | { kind: 'passed' }
  | { kind: 'replied'; message?: string }
  | { kind: 'waiting' };

/**
 * A request that no Script on the Message Path handled rejects with code
 * `send failed` and reason `unhandled`. A Script that crashed rejects with
 * the same code but reason `errored`, so the reason is what tells them apart.
 */
const isUnhandled = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'send failed' &&
  (error as { reason?: unknown }).reason === 'unhandled';

/** An argument sent to a Script: text, or an entity (sent as its Handle) */
export type ScriptArg = string | { entity: EntityId };

export type ScriptRunner = {
  /**
   * Ask an entity's Scripts whether something may happen, as a NorthTalk
   * Decision: a `, deciding` handler that vetoes gives `replied` with the
   * veto's reason; one that allows, passes to the end of the Message Path or
   * isn't there gives `passed`; an undecided Decision gives `failed`.
   */
  decide: (
    key: string,
    id: EntityId,
    message: string,
    args: ScriptArg[],
    context?: CommandContext
  ) => ScriptReply;
  /** Forget a command's request, e.g. once it has been answered */
  forget: (key: string) => void;
  /** Does a Script sit on this entity's Message Path? */
  hasScript: (id: EntityId) => boolean;
  /**
   * Send a message to an entity's Scripts without waiting for an answer, such
   * as a lifecycle message. It still counts towards `settled` when its Run
   * ends, so a tick runs the passes that deliver what the Script did.
   */
  notify: (id: EntityId, message: string, args: ScriptArg[]) => void;
  /**
   * Send a message to an entity's Scripts, such as a command's verb or a
   * veto question. The first call for a key sends the request; later calls
   * report its state until it is forgotten.
   */
  offer: (
    key: string,
    id: EntityId,
    message: string,
    args: ScriptArg[],
    /** The command, for the Script to ask about (`mua`'s `command`) */
    context?: CommandContext
  ) => ScriptReply;
  /** How many requests have been answered so far; grows by one per answer */
  settled: () => number;
};

/** A runner for worlds without Scripts: nothing has one */
export const NO_SCRIPTS: ScriptRunner = {
  decide: () => ({ kind: 'passed' }),
  forget: () => {},
  hasScript: () => false,
  notify: () => {},
  offer: () => ({ kind: 'passed' }),
  settled: () => 0
};

export const createScriptRunner = (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk<MuaComponents>,
  scriptedAtoms: ReadonlySet<string>,
  contexts?: CommandContexts
): ScriptRunner => {
  const replies = new Map<string, ScriptReply>();
  /** The Delivery each request key made, to drop its command when forgotten */
  const deliveries = new Map<string, string>();

  const noteContext = (
    key: string,
    delivery: string,
    context: CommandContext | undefined
  ) => {
    if (context && contexts) {
      contexts.note(delivery, context);
      deliveries.set(key, delivery);
    }
  };
  let settled = 0;

  /** Is a scripted atom anywhere in these bases or their own lineages? */
  const reachesScript = (bases: string[], seen: Set<string>): boolean =>
    bases.some(base => {
      if (scriptedAtoms.has(base)) {
        return true;
      }
      if (seen.has(base)) {
        return false;
      }
      seen.add(base);
      return reachesScript(world.getAtomLineage(base) ?? [], seen);
    });

  const hasScript = (id: EntityId) =>
    scriptedAtoms.size > 0 &&
    reachesScript(world.getEntityLineage(id), new Set());

  const toValues = (args: ScriptArg[]) =>
    args.map(arg =>
      typeof arg === 'string' ? text(arg) : ecsTalk.handle(arg.entity).value
    );

  /** Starts a request for a key once, then reports what is known */
  const once = (key: string, start: () => void): ScriptReply => {
    const existing = replies.get(key);
    if (existing) {
      return existing;
    }
    const waiting: ScriptReply = { kind: 'waiting' };
    replies.set(key, waiting);
    start();
    return waiting;
  };

  const settle = (key: string, reply: ScriptReply) => {
    settled++;
    replies.set(key, reply);
  };

  const decide: ScriptRunner['decide'] = (key, id, message, args, context) =>
    once(key, () => {
      const deciding = ecsTalk.decide(id, message, ...toValues(args));
      noteContext(key, deciding.id, context);
      deciding.decided.then(
        decided => {
          if (decided.verdict === 'vetoed') {
            const reason = decided.vetoes[0]?.reason;
            const text = reason?.kind === 'text' ? reason.asText() : undefined;
            settle(key, { kind: 'replied', message: text });
          } else if (decided.verdict === 'allowed') {
            settle(key, { kind: 'passed' });
          } else {
            log.error(`Script left ${message} undecided:`, decided.undecided);
            settle(key, { kind: 'failed' });
          }
        },
        (error: unknown) => {
          log.error(`Script failed deciding ${message}:`, error);
          settle(key, { kind: 'failed' });
        }
      );
    });

  const offer: ScriptRunner['offer'] = (key, id, message, args, context) =>
    once(key, () => {
      const request = ecsTalk.request(id, message, ...toValues(args));
      noteContext(key, request.id, context);
      request.result.then(
        value => {
          settle(key, { kind: 'replied', message: value.asText() });
        },
        (error: unknown) => {
          if (isUnhandled(error)) {
            settle(key, { kind: 'passed' });
            return;
          }
          log.error(`Script failed handling ${message}:`, error);
          settle(key, { kind: 'failed' });
        }
      );
    });

  const notify: ScriptRunner['notify'] = (id, message, args) => {
    ecsTalk.request(id, message, ...toValues(args)).result.then(
      () => {
        settled++;
      },
      (error: unknown) => {
        settled++;
        if (!isUnhandled(error)) {
          log.error(`Script failed handling ${message}:`, error);
        }
      }
    );
  };

  return {
    decide,
    forget: key => {
      replies.delete(key);
      const delivery = deliveries.get(key);
      if (delivery !== undefined) {
        contexts?.drop(delivery);
        deliveries.delete(key);
      }
    },
    hasScript,
    notify,
    offer,
    settled: () => settled
  };
};

import type { EcsTalk } from 'ecs-talk';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import { text } from '@northtalk/ts';

import type { MuaComponents } from '../coms';

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

export type ScriptRunner = {
  /** Forget a command's request, e.g. once it has been answered */
  forget: (key: string) => void;
  /** Does a Script sit on this entity's Message Path? */
  hasScript: (id: EntityId) => boolean;
  /**
   * Offer a command to an entity's Scripts. The first call for a key sends
   * the request; later calls report its state until it is forgotten.
   */
  offer: (
    key: string,
    id: EntityId,
    verb: string,
    role: string,
    actorId: EntityId
  ) => ScriptReply;
  /** How many requests have been answered so far; grows by one per answer */
  settled: () => number;
};

/** A runner for worlds without Scripts: nothing has one */
export const NO_SCRIPTS: ScriptRunner = {
  forget: () => {},
  hasScript: () => false,
  offer: () => ({ kind: 'passed' }),
  settled: () => 0
};

export const createScriptRunner = (
  world: World<MuaComponents>,
  ecsTalk: EcsTalk<MuaComponents>,
  scriptedAtoms: ReadonlySet<string>
): ScriptRunner => {
  const replies = new Map<string, ScriptReply>();
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

  const offer: ScriptRunner['offer'] = (key, id, verb, role, actorId) => {
    const existing = replies.get(key);
    if (existing) {
      return existing;
    }

    const waiting: ScriptReply = { kind: 'waiting' };
    replies.set(key, waiting);

    const request = ecsTalk.request(
      id,
      verb,
      text(role),
      ecsTalk.handle(actorId).value
    );
    request.result.then(
      value => {
        settled++;
        const message = value.asText();
        replies.set(key, { kind: 'replied', message });
      },
      (error: unknown) => {
        settled++;
        if (isUnhandled(error)) {
          replies.set(key, { kind: 'passed' });
          return;
        }
        log.error(`Script failed handling ${verb}:`, error);
        replies.set(key, { kind: 'failed' });
      }
    );
    return waiting;
  };

  return {
    forget: key => {
      replies.delete(key);
    },
    hasScript,
    offer,
    settled: () => settled
  };
};

import { elements, fromScript, type EcsTalk } from 'ecs-talk';
import { query, type Eid, type Store } from 'odgn-ecs/store';

import {
  defineCapability,
  list,
  map,
  nothing,
  num,
  shape,
  text,
  type Call,
  type Value
} from '@northtalk/ts';

import type { Arg, Context } from './dispatch';
import { charactersAt, output, queueAct, type Act } from './tables';

/**
 * mua's own Capability for Scripts, as `MuaWorld.Talk`: `act`, `announce`,
 * `buildable`, `command`, `homed`, `notice`, `placed`, `signature` and
 * `verbs`. The command a Run handles is
 * the host term of its Delivery (`talk.delivery`). Scripts fill in message
 * templates themselves; the Host formats no text (ADR 0024).
 */

type Notice = { args: Arg[]; message: string; place: Eid };

/** Notices Scripts asked for, sent between Pumps */
export type Notices = Notice[];

/** An argument as a Value: an entity's Handle, text, or Nothing */
export const argValue = (talk: EcsTalk, arg: Arg): Value => {
  if (arg == null) {
    return nothing;
  }
  return typeof arg === 'string' ? text(arg) : talk.handle(arg.entity).value;
};

const context = (talk: EcsTalk, call: Call<unknown>) =>
  talk.delivery(call)?.host as Context | undefined;

/**
 * Sends a notice to the Scripts of the things in a place, but not the one
 * it is about (its first argument), such as the actor who arrived
 */
const notify = (talk: EcsTalk, store: Store, n: Notice) => {
  const first = n.args[0];
  const about = first && typeof first === 'object' ? first.entity : undefined;
  const values = n.args.map(a => argValue(talk, a));
  for (const watcher of elements(store, n.place)) {
    if (watcher !== about && talk.isScripted(watcher)) {
      talk.deliver(watcher, n.message, values);
    }
  }
};

/**
 * The engine's `between` hook: sends the notices Scripts asked for since
 * the last Pump, and says whether there were any
 */
export const between =
  (talk: EcsTalk, store: Store, notices: Notices) => () => {
    const sent = notices.splice(0);
    for (const n of sent) {
      notify(talk, store, n);
    }
    return sent.length > 0;
  };

/** The `mua` Capability, for `createEcsTalk`'s `capabilities` */
export const muaCapability =
  (store: Store, notices: Notices) => (talk: EcsTalk) => {
    const entity = shape.object(talk.entityKind);
    const handle = (eid: Eid | null) =>
      eid === null ? nothing : talk.handle(eid).value;
    return defineCapability('mua', {
      act: {
        args: [entity, shape.any],
        command: true,
        cost: { fuel: 1 },
        fire: (_call, actor, command) =>
          queueAct(store, actor.native.eid, fromScript(command) as Act),
        mode: 'fire-and-forget'
      },
      announce: {
        args: [entity, shape.text, shape.optional(entity)],
        command: true,
        cost: { fuel: 1 },
        fire: (_call, place, line, except) => {
          const skip = except?.native.eid;
          for (const c of charactersAt(store, place.native.eid)) {
            if (c !== skip) {
              output(store, c, line);
            }
          }
        },
        mode: 'fire-and-forget'
      },
      buildable: {
        args: [],
        cost: { fuel: 1 },
        do: () =>
          list(
            ...[...store.components.values()]
              .filter(c => c.buildable)
              .map(c => c.name)
              .sort()
              .map(text)
          ),
        mode: 'immediate',
        result: shape.listOf(shape.text)
      },
      command: {
        args: [],
        cost: { fuel: 1 },
        do: call => {
          const ctx = context(talk, call);
          if (!ctx) {
            return nothing;
          }
          return map([
            ['actor', handle(ctx.actor)],
            [
              'direction',
              ctx.direction === null ? nothing : text(ctx.direction)
            ],
            ['indirect', handle(ctx.indirectId)],
            ['target', handle(ctx.targetId)],
            ['text', ctx.text === null ? nothing : text(ctx.text)],
            ['verb', text(ctx.verb)]
          ]);
        },
        mode: 'immediate',
        result: shape.any
      },
      homed: {
        args: [entity],
        cost: { fuel: 1 },
        do: (_call, place) =>
          list(
            ...query(store, {
              where: [['home', 'in', place.native.eid]]
            }).map(handle)
          ),
        mode: 'immediate',
        result: shape.listOf(entity)
      },
      notice: {
        args: [entity, shape.text, entity, shape.optional(shape.text)],
        command: true,
        cost: { fuel: 1 },
        fire: (_call, place, message, who, extra) => {
          notices.push({
            args: [
              { entity: who.native.eid },
              ...(extra == null ? [] : [extra])
            ],
            message,
            place: place.native.eid
          });
        },
        mode: 'fire-and-forget'
      },
      placed: {
        args: [entity],
        cost: { fuel: 1 },
        do: (_call, account) =>
          num(
            query(store, {
              where: [['made_by', 'account', account.native.eid]]
            }).length
          ),
        mode: 'immediate',
        result: shape.number
      },
      // an Account's Signature: the Character that speaks for it wherever
      // it is shown as a Maker, its first while it has one (#276)
      signature: {
        args: [entity],
        cost: { fuel: 1 },
        do: (_call, account) => {
          const characters = query(store, {
            where: [['player', 'account', account.native.eid]]
          });
          return characters.length === 0
            ? nothing
            : handle(Math.min(...characters));
        },
        mode: 'immediate',
        result: shape.optional(entity)
      },
      verbs: {
        args: [],
        cost: { fuel: 1 },
        do: call => {
          const vocabulary = context(talk, call)?.vocabulary;
          if (!vocabulary) {
            return nothing;
          }
          return map([
            [
              'aliases',
              list(...[...vocabulary.aliases.keys()].sort().map(text))
            ],
            [
              'names',
              list(
                ...[...new Set(vocabulary.defs.map(d => d.names[0]!))].map(text)
              )
            ]
          ]);
        },
        mode: 'immediate',
        result: shape.any
      }
    });
  };

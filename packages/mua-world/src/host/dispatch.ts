import { get, type Eid, type Store } from 'odgn-ecs/store';

import { location } from '../commands/scope';
import type { Vocabulary } from '../commands/verbs';
import { find } from '../exits';

/**
 * What dispatch asks about a command, in turn, as `MuaWorld.Dispatch`
 * (ADR 0024): the receivers (the room, the second object, then the thing
 * acted on), each offered the command; the Verb's veto Decisions; the
 * Action, a Request to the Service Script the World names for it (ADR
 * 0029); and once it has succeeded, `after<Action>` to the same receivers.
 */

/** A command as dispatch sees it: the bound command and who typed what */
export type Context = {
  actor: Eid;
  direction: string | null;
  indirectId: Eid | null;
  raw: string;
  targetId: Eid | null;
  text: string | null;
  verb: string;
  vocabulary: Vocabulary;
};

/** An argument for a Script: an entity, text or Nothing */
export type Arg = { entity: Eid } | string | null;

export type To = Eid | { service: string };

export type Question = {
  args: Arg[];
  asks: 'decide' | 'offer';
  kind: 'action' | 'receiver' | 'veto';
  message: string;
  to: To;
};

export const CANNOT = "You can't do that.";

const receivers = (store: Store, ctx: Context): Question[] =>
  (
    [
      ['room', location(store, ctx.actor)],
      ['indirect', ctx.indirectId],
      ['target', ctx.targetId]
    ] as const
  )
    .filter(([, id]) => id !== null)
    .map(([role, id]) => ({
      args: [role, { entity: ctx.actor }],
      asks: 'offer',
      kind: 'receiver',
      message: ctx.verb,
      to: id!
    }));

/** Where a move goes, or why it can't happen */
export const planMove = (
  store: Store,
  ctx: Context
):
  | { exit: Eid; from: Eid; kind: 'go'; to: Eid }
  | { kind: 'refused'; message: string } => {
  const from = location(store, ctx.actor);
  if (ctx.direction === null) {
    return { kind: 'refused', message: 'Which direction?' };
  }
  if (from === null) {
    return { kind: 'refused', message: 'You are nowhere.' };
  }
  const exit = find(store, from, ctx.direction);
  if (exit === null) {
    return {
      kind: 'refused',
      message: `You can't go ${ctx.direction} from here.`
    };
  }
  const portal = get(store, exit, 'portal');
  return typeof portal?.to === 'number'
    ? { exit, from, kind: 'go', to: portal.to }
    : {
        kind: 'refused',
        message: (portal?.msg as string | null) ?? 'That exit leads nowhere.'
      };
};

// The entities a Command concerns, by role. `exit`, `from` and `to` are
// there only for a Command with a Direction that leads somewhere.
const roles = (store: Store, ctx: Context): Record<string, Eid | null> => {
  const move = ctx.direction === null ? null : planMove(store, ctx);
  return {
    ...(move?.kind === 'go'
      ? { exit: move.exit, from: move.from, to: move.to }
      : {}),
    actor: ctx.actor,
    holder: ctx.targetId === null ? null : location(store, ctx.targetId),
    indirect: ctx.indirectId,
    room: location(store, ctx.actor),
    target: ctx.targetId
  };
};

const role = (r: Record<string, Eid | null>, name: string): To | null =>
  name.startsWith('service:')
    ? { service: name.slice('service:'.length) }
    : (r[name] ?? null);

// The Verb's veto Decisions; when a role is missing, such as a move with
// no exit, none is asked
const vetoes = (store: Store, ctx: Context): Question[] => {
  const declared = ctx.vocabulary.vetoes.get(ctx.verb) ?? [];
  if (declared.length === 0) {
    return [];
  }
  const r = roles(store, ctx);
  const events = declared.map(v => ({
    event: v.event,
    subject: role(r, v.about),
    to: role(r, v.asks)
  }));
  if (events.some(e => e.to === null || e.subject === null)) {
    return [];
  }
  return events.map(e => ({
    args: [{ entity: ctx.actor }, { entity: e.subject as Eid }],
    asks: 'decide',
    kind: 'veto',
    message: e.event,
    to: e.to!
  }));
};

/** The questions asked before the action runs, in order */
export const questions = (store: Store, ctx: Context) => [
  ...receivers(store, ctx),
  ...vetoes(store, ctx)
];

/** The `after<Action>` questions, asked of the receivers once the action has succeeded */
export const afters = (store: Store, ctx: Context) =>
  receivers(store, ctx).map(q => ({
    ...q,
    message: `after${ctx.verb.charAt(0).toUpperCase()}${ctx.verb.slice(1)}`
  }));

/**
 * What to send for an action, or why it can't happen. The World declares
 * which Service carries out each Action and the roles it is sent (ADR
 * 0029); the message is the Action's name, and the rest of the line follows
 * the roles when the Command has one. An Action with no Service is carried
 * out only by the Receivers, so reaching here, nothing did it.
 */
export const plan = (
  store: Store,
  ctx: Context
):
  | { args: Arg[]; kind: 'send'; message: string; to: To }
  | { kind: 'refused'; message: string } => {
  const action = ctx.vocabulary.actions.get(ctx.verb);
  if (!action?.service) {
    return { kind: 'refused', message: CANNOT };
  }
  const r = roles(store, ctx);
  const args: Arg[] = [];
  for (const name of action.args) {
    const eid = role(r, name);
    if (typeof eid === 'number') {
      args.push({ entity: eid });
    } else if (name === 'room') {
      return { kind: 'refused', message: 'You are nowhere.' };
    } else if (name === 'exit' || name === 'from' || name === 'to') {
      const move = planMove(store, ctx);
      return move.kind === 'refused'
        ? move
        : { kind: 'refused', message: CANNOT };
    } else {
      args.push(null);
    }
  }
  return {
    args: ctx.text === null ? args : [...args, ctx.text],
    kind: 'send',
    message: ctx.verb,
    to: { service: action.service }
  };
};

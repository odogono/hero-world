import type { EntityId } from 'odgn-ecs/types';

import { getEntity } from '../queries/entity';
import { theName } from '../queries/scope';
import type { ActionContext } from './types';

/**
 * Who sees a message:
 * - `msg`  the actor
 * - `omsg` everyone else in the room
 */
export type MessageKind = 'msg' | 'omsg';

/**
 * The messages built-in actions use, by verb handler. A thing overrides
 * them with a `messages` component, e.g.
 * `messages { omsg: { take: "{actor} heaves {the target} onto a shoulder." } }`.
 */
export const DEFAULT_MESSAGES: Record<
  string,
  Partial<Record<MessageKind, string>>
> = {
  arrive: { omsg: '{actor} arrives.' },
  close: { msg: 'Closed.', omsg: '{actor} closes {the target}.' },
  drop: { msg: 'Dropped.', omsg: '{actor} drops {the target}.' },
  move: { omsg: '{actor} goes {dir}.' },
  open: { msg: 'Opened.', omsg: '{actor} opens {the target}.' },
  take: { msg: 'Taken.', omsg: '{actor} takes {the target}.' }
};

export type TemplateValues = Partial<
  Record<'actor' | 'dir' | 'indirect' | 'target', string>
> & {
  /** Names that take "the" when written as `{the target}` */
  the?: Partial<Record<'indirect' | 'target', string>>;
};

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Fills in `{actor}`, `{target}`, `{the target}`, `{indirect}`,
 * `{the indirect}` and `{dir}`. A capital letter (`{Actor}`, `{The target}`)
 * capitalises the value. Unknown placeholders are left as written.
 */
export const renderTemplate = (template: string, values: TemplateValues) =>
  template.replaceAll(/{(the |The )?(\w+)}/g, (whole, article, key) => {
    const name = String(key).toLowerCase() as keyof TemplateValues;
    const value = article
      ? values.the?.[name as 'indirect' | 'target']
      : (values[name] as string | undefined);
    if (value === undefined) {
      return whole;
    }
    const isCapital = /^[A-Z]/.test(article ?? String(key));
    return isCapital ? capitalise(value) : value;
  });

const nameOf = (ctx: ActionContext, id: EntityId | undefined) => {
  const described = getEntity(ctx.world, id, ['described']);
  const player = getEntity(ctx.world, id, ['player']);
  const name = player?.player.name ?? described?.described.name;
  return name === undefined ? undefined : { isPlayer: Boolean(player), name };
};

/** The values a command's messages can refer to */
export const templateValues = (ctx: ActionContext): TemplateValues => {
  const actor = nameOf(ctx, ctx.playerId);
  const target = nameOf(ctx, ctx.targetId);
  const indirect = nameOf(ctx, ctx.indirectId);
  return {
    actor: actor?.name ?? 'Someone',
    dir: ctx.direction,
    indirect: indirect?.name.toLowerCase(),
    target: target?.name.toLowerCase(),
    the: {
      indirect: indirect && theName(indirect),
      target: target && theName(target)
    }
  };
};

/**
 * The message for a handler: the one set on `ownerId`'s `messages`
 * component (its own or inherited), else the default. Returns undefined
 * when there is neither.
 */
export const messageFor = (
  ctx: ActionContext,
  handler: string,
  kind: MessageKind,
  ownerId: EntityId | undefined = ctx.targetId
) => {
  const owned = getEntity(ctx.world, ownerId, ['messages'])?.messages[kind];
  const table = (owned ?? {}) as Record<string, unknown>;
  const template =
    typeof table[handler] === 'string'
      ? table[handler]
      : DEFAULT_MESSAGES[handler]?.[kind];
  return template === undefined
    ? undefined
    : renderTemplate(template, templateValues(ctx));
};

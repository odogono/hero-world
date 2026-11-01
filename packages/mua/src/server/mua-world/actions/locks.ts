import type { EntityId } from 'odgn-ecs/types';

import { isClosed } from '../queries/doors';
import { getEntity, getLocationOf } from '../queries/entity';
import { getElements, theName } from '../queries/scope';
import { messageFor } from './messages';
import { refused, type ActionContext, type ActionOutcome } from './types';

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const nameOf = (ctx: ActionContext, id: EntityId) =>
  theName({
    isPlayer: false,
    name: getEntity(ctx.world, id, ['described'])?.described.name ?? 'it'
  });

/** Does this key fit this lock? */
export const fits = (ctx: ActionContext, keyId: EntityId, lock: string) =>
  getEntity(ctx.world, keyId, ['key'])?.key.opens.includes(lock) ?? false;

/** Why the target can't be opened, if it is locked */
export const lockedRefusal = (
  ctx: ActionContext,
  id: EntityId
): ActionOutcome | undefined => {
  const lockable = getEntity(ctx.world, id, ['lockable']);
  return lockable?.lockable.isLocked
    ? refused(`${capitalise(nameOf(ctx, id))} is locked.`)
    : undefined;
};

/**
 * Locks or unlocks the target with a key. With no key named, uses one the
 * actor carries that fits, and says which.
 */
const setLocked = (ctx: ActionContext, isLocked: boolean): ActionOutcome => {
  const verb = isLocked ? 'lock' : 'unlock';
  const target = getEntity(ctx.world, ctx.targetId, ['lockable'], true);
  if (!target) {
    return refused(`You can't ${verb} that.`);
  }
  const name = nameOf(ctx, target.id);
  const { lock } = target.lockable;
  if (target.lockable.isLocked === isLocked) {
    return refused(
      `${capitalise(name)} is already ${isLocked ? 'locked' : 'unlocked'}.`
    );
  }
  if (isLocked && isClosed(ctx.world, target.id) === false) {
    return refused(`You'll have to close ${name} first.`);
  }

  let keyId = ctx.indirectId;
  let chosen: string | undefined;
  if (keyId === undefined) {
    keyId = getElements(ctx.world, ctx.playerId).find(c =>
      fits(ctx, c.id, lock)
    )?.id;
    if (keyId === undefined) {
      return refused(`You need a key to ${verb} ${name}.`);
    }
    chosen = `(with ${nameOf(ctx, keyId)})`;
  } else if (!getEntity(ctx.world, keyId, ['key'])) {
    return refused(`You can't ${verb} anything with that.`);
  } else if (!fits(ctx, keyId, lock)) {
    return refused(`${capitalise(nameOf(ctx, keyId))} doesn't fit.`);
  }

  target.lockable = { ...target.lockable, isLocked };
  ctx.world.flush();

  const withKey = { ...ctx, indirectId: keyId };
  const roomId = getLocationOf(ctx.world, ctx.playerId);
  const others = messageFor(withKey, verb, 'omsg');
  return {
    broadcasts:
      roomId === undefined || !others
        ? undefined
        : [{ exclude: ctx.playerId, message: others, to: roomId }],
    kind: 'done',
    message: [chosen, messageFor(withKey, verb, 'msg')]
      .filter(Boolean)
      .join('\n')
  };
};

export const lockAction = (ctx: ActionContext) => setLocked(ctx, true);
export const unlockAction = (ctx: ActionContext) => setLocked(ctx, false);

import { DIRECTION_ALIASES, vocabularyOf } from '../commands/verbs';
import { getEntity } from '../queries/entity';
import { done, refused, type ActionContext, type ActionOutcome } from './types';

/** The commands this world understands, by each verb's first name */
export const helpAction = (ctx: ActionContext): ActionOutcome => {
  const names = [
    ...new Set(vocabularyOf(ctx.world).defs.map(def => def.names[0]!))
  ];
  const short = Object.keys(DIRECTION_ALIASES).toSorted().join(', ');
  return done(
    [
      `Commands: ${names.join(', ')}.`,
      `Move by naming a direction: north, south, east, west, up, down and so on (or ${short}).`,
      "Say something with say, or start with a quote: 'hello.",
      'Repeat the last command with again (g).'
    ].join('\n')
  );
};

/** What is written on a thing */
export const readAction = (ctx: ActionContext): ActionOutcome => {
  if (ctx.targetId === undefined) {
    return refused('Read what?');
  }
  const readable = getEntity(ctx.world, ctx.targetId, ['readable']);
  return readable
    ? done(readable.readable.text)
    : refused("There's nothing written on it.");
};

import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import {
  createVocabulary,
  setVocabulary,
  type VerbDef,
  type VerbForm,
  type Vocabulary
} from '../commands/verbs';
import type { MuaComponents } from '../coms';

const log = createLog('verbs');

const SCOPES = new Set(['here', 'inv', 'room']);

const isText = (value: unknown): value is string => typeof value === 'string';

/** A form as written in EDL, or undefined (with a warning) if it isn't one */
const toForm = (value: unknown, where: string): VerbForm | undefined => {
  const form = value as Partial<Record<keyof VerbForm, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    !isText(form.handler) ||
    !isText(form.pattern) ||
    (form.scope !== undefined && !SCOPES.has(form.scope as string)) ||
    (form.indirectScope !== undefined &&
      !SCOPES.has(form.indirectScope as string))
  ) {
    log.warn(`Skipping a verb form in ${where}: ${JSON.stringify(value)}`);
    return undefined;
  }
  return value as VerbForm;
};

const toVerb = (value: unknown, where: string): VerbDef | undefined => {
  const def = value as Partial<Record<keyof VerbDef, unknown>>;
  const names = Array.isArray(def?.names) ? def.names.filter(isText) : [];
  const forms = Array.isArray(def?.forms)
    ? def.forms.flatMap(f => toForm(f, where) ?? [])
    : [];
  if (names.length === 0 || forms.length === 0) {
    log.warn(`Skipping a verb in ${where}: ${JSON.stringify(value)}`);
    return undefined;
  }
  return {
    forms,
    incomplete: isText(def.incomplete) ? def.incomplete : undefined,
    names: names.map(n => n.toLowerCase())
  };
};

/**
 * Reads the verbs every entity's `verbs` component declares, and gives the
 * world a vocabulary of the built-in verbs plus those. A malformed verb is
 * skipped with a warning.
 */
export const loadVerbs = (world: World<MuaComponents>): Vocabulary => {
  const extra = world.queryAll({ with: ['verbs'] }).flatMap(entity => {
    const defs = entity.verbs.defs;
    const where = `entity ${entity.id}`;
    return Array.isArray(defs) ? defs.flatMap(d => toVerb(d, where) ?? []) : [];
  });
  const vocabulary = createVocabulary(extra);
  setVocabulary(world, vocabulary);
  if (extra.length > 0) {
    log.info(`Added ${extra.length} verbs from the world`);
  }
  return vocabulary;
};

import type { PreviewDefinition } from 'mua-local';

/**
 * A composition: the components a Builder gives a thing, new or placed, by
 * name, each a map of its fields (#260). What the World accepts is the `build`
 * Service's to decide (#258); this only helps the Builder get it right.
 */
export type Composition = Record<string, Record<string, unknown>>;

/** What a card says about a component a Builder may add */
export type Card = {
  /** What it lets the thing do */
  does: string;
  /** Readable names for its fields, by field name */
  fields: Record<string, string>;
  label: string;
  /** Fields shown as a box of text, not one line */
  long?: string[];
  /** Fields to show first, in this order; the rest follow as defined */
  order?: string[];
};

/** The buildable components' cards. One the client doesn't know reads plainly. */
export const CARDS: Record<string, Card> = {
  container: {
    does: 'Lets it hold things, and be opened and closed.',
    fields: { capacity: 'Holds up to', is_closed: 'Starts closed' },
    label: 'Container'
  },
  described: {
    does: 'Gives it a name and a description, so it can be seen and examined.',
    fields: { description: 'Description', name: 'Name' },
    label: 'Description',
    long: ['description'],
    order: ['name', 'description']
  },
  item: {
    does: 'Lets it be picked up and carried.',
    fields: { is_takeable: 'Can be taken', weight: 'Weight' },
    label: 'Item'
  },
  noun: {
    does: 'Lets players call it by other words too.',
    fields: { words: 'Words' },
    label: 'Other words'
  },
  readable: {
    does: 'Puts writing on it, to read.',
    fields: { text: 'Writing' },
    label: 'Writing',
    long: ['text']
  }
};

/** A definition's columns, those the card orders first */
export const fieldOrder = <C extends { name: string }>(
  card: Card,
  columns: C[]
): C[] => {
  const named = card.order ?? [];
  const rank = (c: C) => {
    const i = named.indexOf(c.name);
    return i === -1 ? named.length : i;
  };
  return [...columns].sort((a, b) => rank(a) - rank(b));
};

/** Every thing needs a name, so every composition has a `described` */
export const REQUIRED = 'described';

export const MAX_NAME = 40;
export const MAX_DESCRIPTION = 500;

export const cardFor = (name: string): Card =>
  CARDS[name] ?? { does: '', fields: {}, label: name };

/** A new composition: just a name to fill in */
export const fresh = (): Composition => ({
  [REQUIRED]: { description: '', name: '' }
});

/** The words a name gives a `noun`: each word of it, in lower case */
export const wordsOf = (name: string) =>
  name
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter(Boolean);

/**
 * A component's fields as a new card starts them: each column's default,
 * and for `noun`, the words of the name
 */
export const startFields = (
  definition: PreviewDefinition,
  composition: Composition
): Record<string, unknown> => {
  if (definition.name === 'noun') {
    return { words: wordsOf(nameOf(composition)) };
  }
  return Object.fromEntries(
    definition.columns.map(col => [col.name, col.default ?? null])
  );
};

export const nameOf = (composition: Composition) => {
  const name = composition[REQUIRED]?.name;
  return typeof name === 'string' ? name : '';
};

/**
 * What the World is sent: each field that has a value. An empty field
 * takes its default, and a blank description is left out.
 */
export const toSend = (composition: Composition) =>
  Object.fromEntries(
    Object.entries(composition).map(([component, fields]) => [
      component,
      Object.fromEntries(
        Object.entries(fields).filter(
          ([, v]) =>
            v !== null &&
            v !== undefined &&
            !(typeof v === 'string' && v.trim() === '') &&
            !(typeof v === 'number' && Number.isNaN(v))
        )
      )
    ])
  );

/**
 * An edit as a patch (#275): what changed from the composition the thing
 * was opened with. A new component is put whole, as Place sends it; a
 * changed one puts only the fields that differ; a missing one is removed.
 * A cleared text field is sent as it is, empty, for the World to judge; a
 * number left empty keeps its value.
 */
export const patchOf = (opened: Composition, now: Composition) => {
  const put: Composition = {};
  for (const [component, fields] of Object.entries(now)) {
    const was = opened[component];
    if (!was) {
      put[component] = toSend({ [component]: fields })[component] ?? {};
      continue;
    }
    const changed = Object.fromEntries(
      Object.entries(fields).filter(
        ([field, v]) =>
          v !== null &&
          v !== undefined &&
          !(typeof v === 'number' && Number.isNaN(v)) &&
          !same(v, was[field])
      )
    );
    if (Object.keys(changed).length > 0) {
      put[component] = changed;
    }
  }
  const remove = Object.keys(opened).filter(component => !(component in now));
  return { put, remove };
};

/** Whether a patch would change nothing */
export const unchanged = (patch: ReturnType<typeof patchOf>) =>
  patch.remove.length === 0 && Object.keys(patch.put).length === 0;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** What a composition lets a thing do, in a few words each */
export const abilities = (composition: Composition): string[] => {
  const has = (name: string) => name in composition;
  const found: string[] = [];
  if (has('described')) {
    found.push('Can be seen and examined');
  }
  if (has('item')) {
    found.push(
      composition.item?.is_takeable === false
        ? 'Stays where it is'
        : 'Can be carried'
    );
  }
  if (has('container')) {
    found.push('Can hold things', 'Can be opened and closed');
  }
  if (has('readable')) {
    found.push('Can be read');
  }
  const words = composition.noun?.words;
  if (Array.isArray(words) && words.length > 0) {
    found.push(`Answers to ${words.join(', ')}`);
  }
  return found;
};

/**
 * Why the World would refuse it, as far as the client can tell: each a
 * component and the problem with it. The World checks again on Place.
 */
export const problems = (
  composition: Composition,
  maxCapacity: number | undefined
): { component: string; text: string }[] => {
  const found: { component: string; text: string }[] = [];
  const name = nameOf(composition).trim();
  if (name === '') {
    found.push({ component: REQUIRED, text: 'It needs a name.' });
  } else if (name.length > MAX_NAME) {
    found.push({
      component: REQUIRED,
      text: `A name can be at most ${MAX_NAME} characters.`
    });
  }
  const description = composition[REQUIRED]?.description;
  if (typeof description === 'string' && description.length > MAX_DESCRIPTION) {
    found.push({
      component: REQUIRED,
      text: `A description can be at most ${MAX_DESCRIPTION} characters.`
    });
  }
  const capacity = composition.container?.capacity;
  if (
    maxCapacity !== undefined &&
    typeof capacity === 'number' &&
    capacity > maxCapacity
  ) {
    found.push({
      component: 'container',
      text: `A container can hold at most ${maxCapacity}.`
    });
  }
  return found;
};

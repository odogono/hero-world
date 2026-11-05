import {
  query,
  select,
  type Condition,
  type Data,
  type Eid,
  type Store
} from './index';

export type ElementsOptions = {
  /** The `[component, property]` that holds a Location; `['location', 'in']` by default */
  location?: readonly [string, string];
  /** Narrow them, as in `query` */
  where?: readonly Condition[];
  with?: readonly string[];
};

/**
 * The Elements of `place`: the entities whose Location it is, in id order,
 * as `OdgnEcsTalk.elements/3` gives them. With `names`, each comes with its
 * data for those components, as `select` gives it.
 */
export function elements(
  store: Store,
  place: Eid,
  options?: ElementsOptions
): Eid[];
export function elements(
  store: Store,
  place: Eid,
  options: ElementsOptions & { select: readonly string[] }
): [Eid, Record<string, Data>][];
export function elements(
  store: Store,
  place: Eid,
  options: ElementsOptions & { select?: readonly string[] } = {}
) {
  const [location, field] = options.location ?? ['location', 'in'];
  if (!store.components.has(location)) {
    return [];
  }
  const opts = {
    where: [[location, field, place] as const, ...(options.where ?? [])],
    with: options.with ?? []
  };
  return options.select
    ? select(store, options.select, opts)
    : query(store, opts);
}

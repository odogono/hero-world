import { applyComponentDefaults } from '../component/defaults';
import type { Components, GenericEntity } from '../types';
import type { World } from '../world';

/** JSON with sorted keys, so field order doesn't count as a change */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
          )
        )
      : v
  );

/** A component's fields as the world would store them */
export const normalise = <T extends Components>(
  world: World<T>,
  name: string,
  data: Record<string, unknown> | null | undefined
): string => {
  const columns = world.defs.get(name)?.schema.columns ?? [];
  const withDefaults = applyComponentDefaults(world, name, data ?? {});
  return stable(
    Object.fromEntries(
      columns.map(({ name: field }) => [field, withDefaults[field] ?? null])
    )
  );
};

export const isPlayState = <T extends Components>(
  world: World<T>,
  component: string
) => Boolean(world.defs.get(component)?.schema.playState);

/** An entity's components, read back plainly */
export const readComponents = <T extends Components>(
  world: World<T>,
  eid: number
) =>
  (world.query({
    asProxy: false,
    entity: { id: eid, world } as GenericEntity<T>,
    maybe: [...world.defs.keys()] as (keyof T)[]
  }) ?? {}) as Record<string, Record<string, unknown> | undefined>;

/**
 * Saves the Play state components the EDL gives an entity, as the EDL set
 * them, so a later migration can tell whether play has changed them.
 */
export const recordEDLValues = <T extends Components>(
  world: World<T>,
  eid: number,
  components: Record<string, Record<string, unknown> | undefined>
) => {
  world.deleteEDLValues(eid);
  for (const [component, data] of Object.entries(components)) {
    if (data && isPlayState(world, component)) {
      world.setEDLValue(eid, component, normalise(world, component, data));
    }
  }
};

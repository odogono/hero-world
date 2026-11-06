import { elements } from 'ecs-talk';
import {
  createEntity,
  exists,
  get,
  put,
  query,
  type Data,
  type Eid,
  type Store
} from 'odgn-ecs/store';

/**
 * The places every World has, as `MuaWorld.Places`: Limbo, which holds what
 * is out of play; the system actor, which acts when no Player did; and the
 * Starting room, where a Character enters when it has nowhere valid to
 * return to. Limbo and the system actor are found by `meta.props.id`, and
 * made when the EDL doesn't declare them.
 */
export type Places = { limbo: Eid; startingRoom: Eid; system: Eid };

const find = (store: Store, id: string) =>
  query(store, { with: ['meta'] }).find(
    eid => (get(store, eid, 'meta')?.props as Data | undefined)?.id === id
  );

const make = (store: Store, components: Record<string, Data>) => {
  const eid = createEntity(store);
  for (const [name, data] of Object.entries(components)) {
    put(store, eid, name, data);
  }
  return eid;
};

/** Finds or makes Limbo. Call it inside a transaction. */
export const limbo = (store: Store): Eid =>
  find(store, 'limbo') ??
  make(store, {
    container: { capacity: 10_000, is_closed: false },
    described: { description: 'Nowhere at all.', name: 'Limbo' },
    meta: { props: { id: 'limbo' } }
  });

/**
 * Whether an entity is a place a Character can be in: it exists, isn't
 * Limbo, and isn't inside anything
 */
export const isPlace = (store: Store, eid: Eid, limboId: Eid) =>
  eid !== limboId &&
  exists(store, eid) &&
  get(store, eid, 'location')?.in == null;

/**
 * Finds or makes Limbo and the system actor, and checks the Starting room,
 * given by Definition name. Call it inside a transaction.
 */
export const ensurePlaces = (
  store: Store,
  startingRoom: string,
  named: (name: string) => Eid | undefined
): Places => {
  const limboId = limbo(store);
  const system =
    find(store, 'system') ??
    make(store, {
      described: { description: 'The world itself.', name: 'The world' },
      location: { in: limboId },
      meta: { props: { id: 'system' } }
    });
  const room = named(startingRoom);
  if (room === undefined) {
    throw new Error(
      `the starting room "${startingRoom}" is not an entity of the World`
    );
  }
  if (!isPlace(store, room, limboId)) {
    throw new Error(
      `the starting room "${startingRoom}" is not a top-level place`
    );
  }
  return { limbo: limboId, startingRoom: room, system };
};

/**
 * Where a Character entering from Limbo goes: the room it left, if that is
 * still a place, otherwise the Starting room
 */
export const destination = (store: Store, character: Eid, places: Places) => {
  const room = get(store, character, 'player')?.return_to;
  return typeof room === 'number' && isPlace(store, room, places.limbo)
    ? room
    : places.startingRoom;
};

/** The Characters inside an entity, at any depth */
export const charactersWithin = (
  store: Store,
  eid: Eid,
  seen = new Set<Eid>()
): Eid[] => {
  if (seen.has(eid)) {
    return [];
  }
  seen.add(eid);
  return elements(store, eid, { select: ['player'] }).flatMap(
    ([element, data]) => [
      ...(data.player ? [element] : []),
      ...charactersWithin(store, element, seen)
    ]
  );
};

import {
  createEntity,
  elements,
  get,
  put,
  query,
  type Eid,
  type Store
} from 'odgn-ecs/store';

import { directions, fromWorld, opposite } from './commands/verbs';

/**
 * Turns every room's `exits` component into exit entities, as
 * `MuaWorld.Exits` does. Each direction is the room it leads to, or a spec:
 * `exits { north: $hall, south: { msg: "The windows are barred." },
 * down: { to: $cellar one_way: true } }`.
 *
 * An exit to a room also makes the way back, unless that room already has an
 * exit in the opposite direction or the exit is `one_way`. An exit already
 * there wins, so expanding again on every start makes nothing new.
 */

type Spec = Record<string, unknown>;

const toSpec = (to: unknown): Spec | null =>
  typeof to === 'number'
    ? { to }
    : typeof to === 'object' && to !== null && !Array.isArray(to)
      ? (to as Spec)
      : null;

/** The exit from a room in a direction, or `null` */
export const find = (store: Store, room: Eid, dir: string): Eid | null =>
  elements(store, room, { where: [['portal', 'dir', dir]] })[0] ?? null;

const add = (store: Store, room: Eid, dir: string, spec: Spec) => {
  if (find(store, room, dir) !== null) {
    return [];
  }
  const eid = createEntity(store);
  put(store, eid, 'location', { in: room });
  put(store, eid, 'portal', {
    dir,
    door: spec.door ?? null,
    msg: spec.msg ?? null,
    to: spec.to ?? null
  });
  return [eid];
};

/** Makes the missing exits. Returns the ids of the exits it made. */
export const expand = (store: Store): Eid[] => {
  const vocabulary = fromWorld(store);
  const made: Eid[] = [];
  const waysBack: [Eid, string, Spec][] = [];

  // ways back wait until every room's own exits exist, so an exit a room
  // declares always wins over one made as another room's way back
  for (const room of query(store, { with: ['exits'] })) {
    const exits = get(store, room, 'exits') ?? {};
    for (const dir of directions(vocabulary)) {
      const spec = toSpec(exits[dir]);
      if (!spec) {
        continue;
      }
      made.push(...add(store, room, dir, spec));
      const back = opposite(vocabulary, dir);
      if (typeof spec.to === 'number' && spec.one_way !== true && back) {
        waysBack.push([spec.to, back, { door: spec.door, to: room }]);
      }
    }
  }
  for (const [room, dir, spec] of waysBack) {
    made.push(...add(store, room, dir, spec));
  }
  return made;
};

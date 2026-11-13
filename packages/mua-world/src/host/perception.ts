import { elements, type Data, type Eid, type Store } from 'odgn-ecs/store';

/**
 * What a Character can currently know about the World (see GLOSSARY.md), as
 * `MuaWorld.Perception`: its place, the Elements there that it can see, and
 * what it carries. A Character sees itself and its place; the Elements of
 * its place, other Characters among them; the doors of its place's exits;
 * what it carries; and what is inside any open container it can see, at any
 * depth. It sees nothing inside a closed container or another Character,
 * and nothing anywhere else.
 */
export type Perception = {
  character: Eid;
  entities: Set<Eid>;
  place: Eid | null;
};

/** The components a Perception is worked out from */
const READ = ['container', 'player', 'portal'];

const openContainer = (data: Record<string, Data>) =>
  data.container !== undefined && data.container.is_closed !== true;

// The Elements of a holder, and those of any open container among them,
// never those of another Character
const contents = (store: Store, holder: Eid): Eid[] =>
  elements(store, holder, { select: READ }).flatMap(([eid, data]) =>
    openContainer(data) && data.player === undefined
      ? [eid, ...contents(store, eid)]
      : [eid]
  );

// The doors of a place's exits
const doors = (store: Store, place: Eid) => [
  ...new Set(
    elements(store, place, { select: ['portal'], with: ['portal'] }).flatMap(
      ([, data]) =>
        typeof data.portal?.door === 'number' ? [data.portal.door] : []
    )
  )
];

/** What anyone in `place` sees there: the place, its Elements and its doors */
const around = (store: Store, place: Eid | null): Eid[] =>
  place === null
    ? []
    : [place, ...contents(store, place), ...doors(store, place)];

/** The Perception of `character`, whose place is `place` (null for none) */
export const perceptionOf = (
  store: Store,
  character: Eid,
  place: Eid | null
): Perception => ({
  character,
  entities: new Set([
    character,
    ...contents(store, character),
    ...around(store, place)
  ]),
  place
});

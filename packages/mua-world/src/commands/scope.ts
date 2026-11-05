import {
  elements as elementsOf,
  get,
  select,
  type Data,
  type Eid,
  type Store
} from 'odgn-ecs/store';

import type { Reach } from './verbs';

/**
 * What a Character can refer to by name, as `MuaWorld.Commands.Scope` gives
 * it. A candidate's `words` are the lowercase words that name it: its
 * `noun` words and its name's.
 */
export type Candidate = {
  container: { isClosed: boolean } | null;
  id: Eid;
  isPlayer: boolean;
  isTakeable: boolean;
  location: Eid;
  name: string;
  words: string[];
};

// The components a candidate is made from
const READ = [
  'described',
  'player',
  'container',
  'item',
  'location',
  'noun',
  'portal'
];

/** The entity this one is located in, or `null` */
export const location = (store: Store, eid: Eid | null): Eid | null => {
  const place = eid === null ? undefined : get(store, eid, 'location')?.in;
  return typeof place === 'number' ? place : null;
};

const words = (noun: Data | undefined, name: string) => {
  const nouns = Array.isArray(noun?.words)
    ? noun.words.map(w => String(w).toLowerCase())
    : [];
  return [...new Set([...nouns, ...name.toLowerCase().split(/\s+/)])];
};

const toCandidate = (
  eid: Eid,
  data: Record<string, Data>
): Candidate | null => {
  const { container, described, item, player } = data;
  const name = (described?.name ?? player?.name) as string | null | undefined;
  const place = data.location?.in as Eid | null | undefined;
  if (!name || !place) {
    return null;
  }
  return {
    container: container ? { isClosed: container.is_closed === true } : null,
    id: eid,
    isPlayer: player !== undefined,
    isTakeable: item?.is_takeable === true,
    location: place,
    name,
    words: words(data.noun, name)
  };
};

/**
 * The named Elements of a place, and those of any open containers among
 * them. Players are listed but never searched.
 */
export const elements = (
  store: Store,
  place: Eid,
  exclude: Eid | null = null
): Candidate[] =>
  elementsOf(store, place, { select: READ })
    .filter(([eid, data]) => eid !== exclude && data.portal === undefined)
    .flatMap(([eid, data]) => {
      const candidate = toCandidate(eid, data);
      if (!candidate) {
        return [];
      }
      const inside =
        candidate.container &&
        !candidate.container.isClosed &&
        !candidate.isPlayer
          ? elements(store, eid, exclude)
          : [];
      return [candidate, ...inside];
    });

// The doors of a room's exits, named as if they were in the room
const doors = (store: Store, room: Eid): Candidate[] => {
  const ids = [
    ...new Set(
      elementsOf(store, room, { select: ['portal'], with: ['portal'] })
        .map(([, data]) => data.portal?.door)
        .filter((door): door is Eid => typeof door === 'number')
    )
  ];
  return select(store, ['described', 'noun'], {
    eids: ids,
    with: ['described', 'door']
  })
    .sort(([a], [b]) => ids.indexOf(a) - ids.indexOf(b))
    .flatMap(([door, data]) => {
      const name = data.described?.name;
      return typeof name === 'string'
        ? [
            {
              container: null,
              id: door,
              isPlayer: false,
              isTakeable: false,
              location: room,
              name,
              words: words(data.noun, name)
            }
          ]
        : [];
    });
};

/** The candidates within a Reach for an actor */
export const inReach = (store: Store, actor: Eid, reach: Reach) => {
  const carried = reach === 'room' ? [] : elements(store, actor);
  if (reach === 'carried') {
    return carried;
  }
  const room = location(store, actor);
  return room === null
    ? carried
    : [...carried, ...elements(store, room, actor), ...doors(store, room)];
};

/** "the mailbox", or a player's name as written */
export const theName = ({ isPlayer, name }: Candidate) =>
  isPlayer ? name : `the ${name.toLowerCase()}`;

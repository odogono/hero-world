import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import { getLocationOf } from './entity';

/**
 * Where a verb form looks for its objects:
 * - `inv`  what the actor is carrying
 * - `room` the actor's room, excluding what they carry
 * - `here` both
 */
export type Scope = 'here' | 'inv' | 'room';

/** An entity a player can refer to by name */
export type Candidate = {
  container?: { isClosed: boolean };
  id: EntityId;
  isPlayer: boolean;
  isTakeable: boolean;
  locationId: EntityId;
  name: string;
  /** Lowercase words that can name it: its noun words plus its name's words */
  words: string[];
};

type MuaWorld = World<MuaComponents>;

const queryElements = (world: MuaWorld, locationId: EntityId) =>
  world.queryAll({
    args: [locationId],
    maybe: ['container', 'described', 'item', 'noun', 'player'],
    where: 'location.in = ?1',
    with: ['location'],
    without: ['portal']
  });

const toCandidate = (
  entity: ReturnType<typeof queryElements>[number]
): Candidate | undefined => {
  const name = entity.described?.name ?? entity.player?.name;
  if (!name) {
    return undefined;
  }
  const nameWords = name.toLowerCase().split(/\s+/);
  const nounWords = (entity.noun?.words ?? []).map((w: string) =>
    w.toLowerCase()
  );
  return {
    container: entity.container
      ? { isClosed: entity.container.isClosed }
      : undefined,
    id: entity.id,
    isPlayer: entity.player !== undefined,
    isTakeable: entity.item?.isTakeable ?? false,
    locationId: entity.location.in,
    name,
    words: [...new Set([...nounWords, ...nameWords])]
  };
};

/**
 * The named Elements of a location, and the Elements of any open containers
 * among them. Players are listed but never searched: you can't take from
 * someone else's inventory by looking in the room.
 */
export const getElements = (
  world: MuaWorld,
  locationId: EntityId,
  exclude?: EntityId
): Candidate[] => {
  const result: Candidate[] = [];
  for (const entity of queryElements(world, locationId)) {
    if (entity.id === exclude) {
      continue;
    }
    const candidate = toCandidate(entity);
    if (candidate) {
      result.push(candidate);
    }
    const isOpen = entity.container && !entity.container.isClosed;
    if (isOpen && !entity.player) {
      result.push(...getElements(world, entity.id, exclude));
    }
  }
  return result;
};

export const getInScope = (
  world: MuaWorld,
  actorId: EntityId,
  scope: Scope
): Candidate[] => {
  const carried = scope === 'room' ? [] : getElements(world, actorId);
  if (scope === 'inv') {
    return carried;
  }
  const roomId = getLocationOf(world, actorId);
  const around =
    roomId === undefined ? [] : getElements(world, roomId, actorId);
  return [...carried, ...around];
};

/** "the mailbox", or a player's name as written */
export const theName = (candidate: Pick<Candidate, 'isPlayer' | 'name'>) =>
  candidate.isPlayer ? candidate.name : `the ${candidate.name.toLowerCase()}`;

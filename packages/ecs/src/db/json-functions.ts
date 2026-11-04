import {
  createEntity,
  exists,
  put,
  select,
  type Data,
  type Store
} from '../store';
import type { Components } from '../types';
import type { World } from '../world';
import type { LoadFromJSONOptions, SaveToJSONOptions } from './index';

/** Every entity with each of the World's components it has, as stored */
const readAll = <T extends Components>(world: World<T>) =>
  select(world.store, [...world.defs.keys()]);

/** Save the World as `[{ type, eid, ...data }]`, one per component */
export const saveAsComponents = <T extends Components>(world: World<T>) =>
  readAll(world).flatMap(([eid, components]) =>
    Object.entries(components).map(([type, data]) => ({ eid, type, ...data }))
  );

/** Save the World as `[{ id, [component]: data }]`, one per entity */
export const saveAsEntities = <T extends Components>(world: World<T>) =>
  readAll(world).map(([id, components]) => ({ id, ...components }));

/** Makes entity `eid` if the World has no such entity */
const ensureEntity = (store: Store, eid: number) => {
  if (!exists(store, eid)) {
    store.db.exec('INSERT INTO entities (eid) VALUES (?1)', [eid]);
  }
};

/** Puts a component, keeping only the properties its definition has */
const putKnown = <T extends Components>(
  world: World<T>,
  eid: number,
  type: string,
  data: Record<string, unknown>
) => {
  const def = world.defs.get(type);
  if (!def) {
    return;
  }
  const known: Data = {};
  for (const { name } of def.component.columns) {
    if (name in data) {
      known[name] = data[name];
    }
  }
  put(world.store, eid, type, known);
};

export const loadFromComponents = <T extends Components>(
  world: World<T>,
  json: unknown
): void => {
  if (!Array.isArray(json)) {
    throw new TypeError('Expected array of components');
  }
  world.db.transaction(() => {
    for (const component of json as unknown[]) {
      if (
        typeof component !== 'object' ||
        component === null ||
        !('type' in component) ||
        !('eid' in component)
      ) {
        throw new Error(
          'Invalid component format: expected object with type and eid properties'
        );
      }
      const { eid, type, ...data } = component as Record<string, unknown>;
      if (typeof eid !== 'number') {
        continue;
      }
      ensureEntity(world.store, eid);
      putKnown(world, eid, type as string, data);
    }
  });
};

export const loadFromEntities = <T extends Components>(
  world: World<T>,
  json: unknown
): void => {
  if (!Array.isArray(json)) {
    throw new TypeError('Expected array of entities');
  }
  world.db.transaction(() => {
    for (const entity of json as unknown[]) {
      if (typeof entity !== 'object' || entity === null || !('id' in entity)) {
        throw new Error(
          'Invalid entity format: expected object with id property'
        );
      }
      const { id, ...components } = entity as Record<string, unknown>;
      const eid = typeof id === 'number' ? id : createEntity(world.store);
      ensureEntity(world.store, eid);
      for (const [type, data] of Object.entries(components)) {
        if (data && typeof data === 'object') {
          putKnown(world, eid, type, data as Record<string, unknown>);
        }
      }
    }
  });
};

export const loadFromJSON = <T extends Components>(
  world: World<T>,
  json: unknown,
  options: LoadFromJSONOptions = {}
) =>
  options.asComponents
    ? loadFromComponents(world, json)
    : loadFromEntities(world, json);

export const saveToJSON = <T extends Components>(
  world: World<T>,
  options: SaveToJSONOptions = {}
) => (options.asComponents ? saveAsComponents(world) : saveAsEntities(world));

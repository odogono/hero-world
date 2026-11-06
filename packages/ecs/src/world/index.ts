import { createLog } from 'odgn-helpers/log';

import {
  addComponent,
  applyComponentDefaults,
  makeTrackedComponent,
  removeComponent,
  toTableName
} from '../component';
import type { ComponentInput } from '../component/types';
import {
  DatabaseType,
  createDatabase,
  type CreateDatabaseOptions,
  type Database,
  type LoadFromJSONOptions,
  type SaveToJSONOptions
} from '../db';
import {
  loadFromJSON as sharedLoadFromJSON,
  saveToJSON as sharedSaveToJSON
} from '../db/json-functions';
import { executeEDL, type ExecuteOptions } from '../edl';
import { parseNodes } from '../edl/compile';
import { parseDefsFromEDL } from '../edl/helpers';
import { edlRecord, type ScriptOwner } from '../edl/record';
import {
  queryEntities,
  queryEntitiesIterator,
  queryEntity,
  type QueryOptions
} from '../entity';
import {
  createComponentNotFoundError,
  createDuplicateComponentDefinitionError,
  createEntityNotFoundError,
  createWorldNotInitializedError
} from '../error';
import {
  createEntity as createInStore,
  define as defineInStore,
  deleteEntity as deleteInStore,
  exists as existsInStore,
  ident,
  openStore,
  putMany as putManyInStore,
  remove as removeFromStore,
  tableName,
  type Store
} from '../store';
import { cdefToComponent } from '../store/cdef';
import type {
  CDef,
  ComponentDef,
  Components,
  EntityCache,
  EntityWithComponents,
  GenericEntity,
  InferComponentsFromCDefs
} from '../types';
import { ChangeConflictError, ChangeScope } from './changes';

export { ChangeConflictError, ChangeScope } from './changes';

const log = createLog('world');

// Create a Proxy wrapper around an entity object that intercepts
// component add/remove via property assignment.
const isDate = (value: unknown): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]';

/**
 * A component's data as the store takes it: only its columns, with Dates as
 * ISO strings
 */
const toStored = (def: ComponentDef, data: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const { name } of def.component.columns) {
    const v = data[name];
    out[name] = isDate(v) ? v.toISOString() : v;
  }
  return out;
};

/** Copies an entity's row of a component onto another entity, replacing its own */
const copyRow = <T extends Components>(
  world: World<T>,
  def: ComponentDef,
  from: number,
  to: number
) => {
  const table = ident(def.tableName);
  const cols = def.component.columns.map(c => ident(c.name));
  const updates =
    cols.length === 0
      ? 'NOTHING'
      : `UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`;
  world.db.exec(
    `INSERT INTO ${table} (${['eid', ...cols].join(', ')}) SELECT ${['?1', ...cols].join(', ')} FROM ${table} WHERE eid = ?2 ON CONFLICT(eid) DO ${updates}`,
    [to, from]
  );
};

const proxyEntity = <T extends Components>(
  world: World<T>,
  entity: GenericEntity<T>
) =>
  new Proxy(entity as GenericEntity<T> & Record<PropertyKey, unknown>, {
    set(target, prop, value) {
      const propName = String(prop);

      // Add/replace component by assignment of an object
      if (
        propName !== 'id' &&
        propName !== 'world' &&
        typeof value === 'object' &&
        value !== null
      ) {
        if (world.defs.has(propName)) {
          addComponent(target, propName, value as T[keyof T]);
          return true;
        }
      }

      // Remove component by assigning null/undefined
      if (
        propName !== 'id' &&
        propName !== 'world' &&
        (value === null || value === undefined)
      ) {
        if (world.defs.has(propName)) {
          removeComponent(target, propName);
          return true;
        }
      }

      // Fallback to normal set
      target[prop] = value;
      return true;
    }
  });

type CreateWorldOptions = Partial<CreateDatabaseOptions> & {
  allowRedefineDefinitions?: boolean;
  dbType?: DatabaseType;
  /** How an EDL given to createWorld reads its includes and scripts */
  edl?: ExecuteOptions;
};

const registerComponentDef = <TComponents extends Components>(
  world: World<TComponents>,
  cdef: CDef
): void => {
  // A definition the World already has keeps whether it is Play state,
  // unless this one says
  const stored = world.store.components.get(cdef.id);
  const component = defineInStore(
    world.store,
    cdefToComponent(cdef, cdef.playState ?? stored?.playState)
  );
  const table = tableName(component);

  const statements = Object.fromEntries(
    Object.entries(cdef.statements ?? {}).map(([key, sql]) => [
      key,
      // a definition's own SQL names its table `tbl_<id>`
      world.db.prepare(sql.replaceAll(toTableName(cdef.id), table))
    ])
  );

  world.defs.set(cdef.id, {
    component,
    name: cdef.id,
    schema: cdef,
    statements,
    tableName: table
  });
};

export type { ScriptOwner } from '../edl/record';

export class World<TComponents extends Components> {
  db!: Database;
  options: CreateWorldOptions;

  componentTypes: (keyof TComponents)[];
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entitiesToDelete: Set<number>;
  entityCache: EntityCache<TComponents>;
  defs: Map<string, ComponentDef>;
  /** The shared World layout this World is stored in */
  store!: Store;
  /**
   * World time: advanced by the Frame loop (`loop/`, by its `frameMs`) or
   * by `advanceTime`, never by the wall clock. Events are due by it.
   */
  time = 0;
  /** The Change Scope that writes join, while one is running */
  activeChanges: ChangeScope<TComponents> | undefined;
  /** The open Change Scope holding each entity it has touched */
  changeHolders: Map<number, ChangeScope<TComponents>>;

  constructor(options: CreateWorldOptions) {
    this.options = options;
    this.componentTypes = [];
    this.dirtyEntities = new Map<number, Set<keyof TComponents>>();
    this.entitiesToDelete = new Set<number>();
    this.entityCache = new Map();
    this.defs = new Map<string, ComponentDef>();
    this.activeChanges = undefined;
    this.changeHolders = new Map();
  }

  /**
   * Open a Change Scope: writes made inside `scope.run(fn)` can later be
   * committed into the pending changes, or discarded. See `ChangeScope`.
   */
  openChanges(): ChangeScope<TComponents> {
    return new ChangeScope(this);
  }

  /** Moves World time on, and keeps it with the World */
  advanceTime(delta: number) {
    this.setTime(this.time + delta);
  }

  /** Sets World time, and keeps it with the World */
  setTime(time: number) {
    this.time = time;
    this.db.exec(
      "INSERT OR REPLACE INTO ecs_meta (key, value) VALUES ('time', ?1)",
      [JSON.stringify(time)]
    );
  }

  /**
   * Called before an entity's pending state changes. Inside a Change Scope it
   * records the entity's state first; it throws `ChangeConflictError` when
   * another open scope holds the entity.
   */
  noteChange(eid: number, created = false) {
    const holder = this.changeHolders.get(eid);
    const scope = this.activeChanges;
    if (holder && holder !== scope) {
      throw new ChangeConflictError(eid);
    }
    scope?.noteChange(eid, created);
  }

  /** Atoms and entities that own a Script, with the Script's source path */
  getScriptOwners(): ScriptOwner[] {
    return edlRecord(this).getScriptOwners();
  }

  /** Each Definition name the EDL gave, with the id of its entity */
  getDefinitionNames(): Map<string, number> {
    return edlRecord(this).getDefinitionNames();
  }

  /** The ordered base atoms an entity was built from (empty if none) */
  getEntityLineage(eid: number): string[] {
    return edlRecord(this).getEntityLineage(eid);
  }

  /** The ordered base atoms an atom extends, or undefined if no such atom */
  getAtomLineage(name: string): string[] | undefined {
    return edlRecord(this).getAtomLineage(name);
  }

  async open() {
    // If already open, do nothing (idempotent)
    if (this.db) {
      return;
    }

    this.db = await createDatabase({
      ...this.options,
      path: this.options.path || ':memory:',
      // `dbType` is the older spelling of `type`
      type: this.options.dbType ?? this.options.type ?? DatabaseType.BUN
    });

    // todo check whether the db contains existing data
    // if it does, then load the existing definitions

    // if the db is empty, then initialise it
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
  }

  isOpen() {
    return !!this.db;
  }

  create(initialComponents?: {
    [K in keyof TComponents]?: ComponentInput<TComponents[K]>;
  }): EntityWithComponents<TComponents, keyof TComponents> {
    const eid = this.db.addEntity();
    this.noteChange(eid, true);

    const entity: GenericEntity<TComponents> & Record<string, unknown> = {
      id: eid,
      world: this
    };

    this.entityCache.set(eid, {});

    if (initialComponents) {
      for (const [c, data] of Object.entries(initialComponents)) {
        const name = c as string;
        if (data) {
          // Apply default values from the component schema
          const dataWithDefaults = applyComponentDefaults(this, name, data);

          entity[name] = makeTrackedComponent(
            entity,
            name,
            dataWithDefaults,
            false
          );

          if (!this.dirtyEntities.has(eid)) {
            this.dirtyEntities.set(eid, new Set());
          }
          this.dirtyEntities.get(eid)!.add(name);
        }
      }
    }
    // Wrap in a Proxy that intercepts component add/remove via assignment
    const proxied = proxyEntity(this, entity);

    return proxied as EntityWithComponents<TComponents, keyof TComponents>;
  }

  /**
   * Clone an entity or entity ID including all components and their data
   *
   * @param entityOrId - The entity or entity ID to clone
   * @returns The cloned entity (with id only, no components loaded)
   */
  clone(
    entityOrId: EntityWithComponents<TComponents, keyof TComponents> | number
  ): GenericEntity<TComponents> {
    const sourceEid =
      typeof entityOrId === 'number' ? entityOrId : entityOrId.id;

    // Verify source entity exists
    const sourceEntity = this.get(sourceEid);
    if (!sourceEntity) {
      throw createEntityNotFoundError(sourceEid);
    }

    const newEid = createInStore(this.store);
    this.db.transaction(() => {
      for (const def of this.defs.values()) {
        copyRow(this, def, sourceEid, newEid);
      }
    });

    return { id: newEid, world: this };
  }

  /**
   * Copy all components from one entity to another entity
   *
   * @param source - The source entity or entity ID to copy from
   * @param target - The target entity or entity ID to copy to
   * @returns The target entity with copied components
   */
  copy(
    source: EntityWithComponents<TComponents, keyof TComponents> | number,
    target: EntityWithComponents<TComponents, keyof TComponents> | number
  ): EntityWithComponents<TComponents, keyof TComponents> {
    // Resolve EIDs
    const sourceEid = typeof source === 'number' ? source : source.id;
    const targetEid = typeof target === 'number' ? target : target.id;

    // Verify existence
    if (!this.get(sourceEid)) {
      throw createEntityNotFoundError(sourceEid);
    }
    if (!this.get(targetEid)) {
      throw createEntityNotFoundError(targetEid);
    }

    this.db.transaction(() => {
      for (const def of this.defs.values()) {
        copyRow(this, def, sourceEid, targetEid);
      }
    });

    // Invalidate caches for target since DB has been updated directly
    this.entityCache.delete(targetEid);
    this.dirtyEntities.delete(targetEid);

    // Return DB entity reference (id/world only)
    return { id: targetEid, world: this } as unknown as EntityWithComponents<
      TComponents,
      keyof TComponents
    >;
  }

  /**
   * Returns an entity instance by its id. This does not include any components.
   *
   * @param id - The id of the entity to return
   * @returns The entity instance, or null if the entity does not exist or
   * is deleted and waiting for the next flush
   */
  get(id: number): GenericEntity<TComponents> | null {
    if (!this.store) {
      throw createWorldNotInitializedError();
    }
    return !this.entitiesToDelete.has(id) && existsInStore(this.store, id)
      ? ({ id, world: this } as GenericEntity<TComponents>)
      : null;
  }

  /**
   * Mark an entity for deletion
   * @param entity
   * @returns
   */
  delete(entity: { id: number }) {
    const { id } = entity;
    this.noteChange(id);

    // Mark entity for deletion instead of immediate deletion
    this.entitiesToDelete.add(id);

    // Clean up caches
    this.entityCache.delete(id);
    this.dirtyEntities.delete(id);

    return null;
  }

  /**
   * Query a single entity
   * @param options
   * @returns
   */
  query<W extends readonly (keyof TComponents)[] = []>(
    options: QueryOptions<TComponents> & { with?: W }
  ): EntityWithComponents<TComponents, W[number]> | null {
    return queryEntity(this, options) as EntityWithComponents<
      TComponents,
      W[number]
    > | null;
  }

  /**
   * Query multiple entities
   * @param options
   * @returns
   */
  queryAll<W extends readonly (keyof TComponents)[] = []>(
    options?: QueryOptions<TComponents> & { with?: W }
  ): EntityWithComponents<TComponents, W[number]>[] {
    return queryEntities(this, options) as EntityWithComponents<
      TComponents,
      W[number]
    >[];
  }

  /**
   * Query an iterator over the entities
   * @param options
   * @returns
   */
  queryIterator<W extends readonly (keyof TComponents)[]>(
    options: QueryOptions<TComponents> & { with: W }
  ) {
    return queryEntitiesIterator(this, options);
  }

  /**
   * Execute EDL script on the world
   *
   * @param edl
   */
  executeEDL(edl: string, options?: ExecuteOptions) {
    executeEDL(this, edl, options);
  }

  flush(): World<TComponents> {
    const { changeHolders, db, defs, entityCache } = this;

    // an open Change Scope's entities stay pending until it closes
    const dirtyEntities = new Map(
      [...this.dirtyEntities].filter(([eid]) => !changeHolders.has(eid))
    );
    const entitiesToDelete = new Set(
      [...this.entitiesToDelete].filter(eid => !changeHolders.has(eid))
    );

    db.transaction(() => {
      // Handle entity deletions first
      for (const eid of entitiesToDelete) {
        deleteInStore(this.store, eid);
        entityCache.delete(eid);
        dirtyEntities.delete(eid);
        this.dirtyEntities.delete(eid);
      }

      // Writes are grouped by component, so each component's are a few
      // multi-row statements rather than one per entity
      const writes = new Map<string, [number, Record<string, unknown>][]>();
      const written: { exists?: boolean }[] = [];
      for (const [eid, components] of dirtyEntities) {
        const cache = entityCache.get(eid);
        if (!cache) {
          continue;
        }
        for (const c of components) {
          const name = c as string;
          const entry = cache[name];
          if (!defs.has(name)) {
            throw createComponentNotFoundError(name, eid);
          }
          if (!entry) {
            continue;
          }
          if (entry.exists === false && entry.data === null) {
            removeFromStore(this.store, eid, name);
            delete cache[name];
            continue;
          }
          const rows = writes.get(name) ?? [];
          rows.push([
            eid,
            toStored(defs.get(name)!, entry.data as Record<string, unknown>)
          ]);
          writes.set(name, rows);
          written.push(entry);
        }
      }
      for (const [name, rows] of writes) {
        putManyInStore(this.store, name, rows);
      }
      for (const entry of written) {
        entry.exists = true;
      }
    });

    // Clear the tracking of what was flushed
    for (const eid of dirtyEntities.keys()) {
      this.dirtyEntities.delete(eid);
    }
    for (const eid of entitiesToDelete) {
      this.entitiesToDelete.delete(eid);
    }

    return this;
  }

  loadFromJSON(json: unknown, options: LoadFromJSONOptions = {}) {
    sharedLoadFromJSON(this, json, options);
  }

  saveToJSON(options: SaveToJSONOptions = {}) {
    return sharedSaveToJSON(this, options);
  }

  async saveToPath(path: string) {
    if (await Bun.file(path).exists()) {
      await Bun.file(path).delete();
    }
    await this.db.saveToPath(path);
  }
}

// Create world with component definitions
// Typed overloads for better component inference
export async function createWorld<const TDefs extends readonly CDef[]>(
  componentDefs: TDefs,
  options?: CreateWorldOptions
): Promise<World<InferComponentsFromCDefs<TDefs>>>;
export async function createWorld(
  componentDefs: CDef[],
  options?: CreateWorldOptions
): Promise<World<Components>>;
export async function createWorld<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped EDL worlds must allow arbitrary component access
  TComponents extends Record<string, any> = Record<string, any>
>(edl: string, options?: CreateWorldOptions): Promise<World<TComponents>>;
export async function createWorld(
  componentDefs: CDef[] | string,
  options?: CreateWorldOptions
) {
  // Support creating a world from an EDL string by parsing component defs
  if (typeof componentDefs === 'string') {
    const defs = parseDefsFromEDL(componentDefs);

    const world = new World(options || {});
    await world.open();
    await initialiseWorldDb(world, defs, options);
    // Build its atoms and entities, if it has any; one with only `def`s
    // leaves the world unbuilt, for a later executeEDL
    const nodes = parseNodes(componentDefs);
    if (nodes.some(node => node.type !== 'component')) {
      executeEDL(world, componentDefs, options?.edl);
    }
    return world;
  }

  const world = new World(options || {});
  await world.open();
  await initialiseWorldDb(world, componentDefs, options);
  return world;
}

const initialiseWorldDb = async <TComponents extends Components>(
  world: World<TComponents>,
  componentDefs: readonly CDef[],
  options?: CreateWorldOptions
) => {
  if (!world.db) {
    throw new Error('Database not open');
  }
  const allowRedefineDefinitions = options?.allowRedefineDefinitions ?? true;

  world.store = openStore(world.db);
  // TypeScript-only for now: World time, which Events are scheduled on
  world.db.exec(
    'CREATE TABLE IF NOT EXISTS ecs_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  );
  const time = world.db.query(
    "SELECT value FROM ecs_meta WHERE key = 'time'"
  )[0] as { value: string } | undefined;
  world.time = time ? (JSON.parse(time.value) as number) : 0;

  // The EDL record's tables, and its Lineage and Script owners
  edlRecord(world);

  // Check for duplicate component definitions
  const seenIds = new Set<string>();
  for (const def of componentDefs) {
    if (seenIds.has(allowRedefineDefinitions ? def.hash : def.id)) {
      throw createDuplicateComponentDefinitionError(def);
    }
    seenIds.add(allowRedefineDefinitions ? def.hash : def.id);
  }

  // Register all components in a single transaction
  if (world.db) {
    world.db.transaction(() => {
      for (const def of componentDefs) {
        registerComponentDef(world, def);
      }
    });
  }

  world.componentTypes = componentDefs.map(
    def => def.id
  ) as (keyof TComponents)[];
};

export const saveWorld = async <T extends Components>(
  world: World<T>,
  path: string
) => {
  await world.saveToPath(path);
};

/**
 * Loads an existing world database from a file path with component compatibility validation
 */
export const loadWorld = async <TDefs extends readonly CDef[]>(
  componentDefs: TDefs,
  path: string,
  options?: Omit<CreateWorldOptions, 'path'>
): Promise<World<InferComponentsFromCDefs<TDefs>>> => {
  // Check if the database file exists
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Database file not found: ${path}`);
  }

  // Create world with the existing database file
  const world = new World({ ...options, path } as CreateWorldOptions);
  await world.open();
  await initialiseWorldDb(world, componentDefs);
  return world as World<InferComponentsFromCDefs<TDefs>>;
};

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
  type SaveToJSONOptions,
  type Statement
} from '../db';
import {
  loadFromJSON as sharedLoadFromJSON,
  saveToJSON as sharedSaveToJSON
} from '../db/json-functions';
import { executeEDL, type ExecuteOptions } from '../edl';
import { parseDefsFromEDL } from '../edl/helpers';
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
import { convertKeysToSnakeCase } from '../helpers/convert-keys';
import {
  cdefToSqlCreate,
  cdefToSqlInsert,
  cdefToSqlUpdate
} from '../schema/cdef-to-sql';
import {
  initializeComponentMetadataTable,
  updateComponentMetadata,
  validateComponentCompatibility
} from '../schema/component-metadata';
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

const serializeValues = (obj: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out[k] = v;
      continue;
    }
    if (isDate(v)) {
      out[k] = v.toISOString();
      continue;
    }
    if (typeof v === 'object') {
      out[k] = JSON.stringify(v);
      continue;
    }
    out[k] = v;
  }
  return out;
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
};

const registerComponentDef = <TComponents extends Components>(
  world: World<TComponents>,
  componentDef: CDef
  // statements: Record<string, string> = {}
): void => {
  if (!world.db) {
    throw new Error('Database not open');
  }

  const name = componentDef.id;

  const result = cdefToSqlCreate(componentDef);
  world.db.exec(result.sql);

  const sqlInsert = cdefToSqlInsert(componentDef, {
    namedParams: true
  });
  const sqlUpdate = cdefToSqlUpdate(componentDef, {
    namedParams: true
  });

  const statements = componentDef.statements || {};

  const additionalStmts = Object.entries(statements).reduce(
    (acc, [key, sql]) => {
      // replace any tbl_ table names with the actual table name
      sql = sql.replace(toTableName(componentDef.id), result.tableName);
      acc[key] = world.db!.prepare(sql);
      return acc;
    },
    {} as Record<string, Statement>
  );

  const def = {
    columns: result.columns,
    name,
    schema: componentDef,
    stmtExists: world.db.prepare(
      `SELECT 1 AS found FROM ${result.tableName} WHERE eid = ?1 LIMIT 1`
    ),
    stmtInsert: world.db.prepare(sqlInsert),
    stmtUpdate: world.db.prepare(sqlUpdate),
    tableName: result.tableName,
    url: componentDef.id!,
    ...additionalStmts
  } as ComponentDef;

  world.defs.set(name, def);
};

export type ScriptOwner =
  | { kind: 'atom'; name: string; src: string }
  | { eid: number; kind: 'entity'; src: string };

export class World<TComponents extends Components> {
  db!: Database;
  options: CreateWorldOptions;

  componentTypes: (keyof TComponents)[];
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entitiesToDelete: Set<number>;
  entityCache: EntityCache<TComponents>;
  defs: Map<string, ComponentDef>;
  stmts: Record<string, Statement>;
  /** Lineage: the ordered base atoms each entity (by id) and atom (by name) extends */
  entityLineage: Map<number, string[]>;
  atomLineage: Map<string, string[]>;
  /** Script owners: atoms (by name) and entities (by id) that declare their own `script`, mapped to its source path */
  atomScripts: Map<string, string>;
  entityScripts: Map<number, string>;
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
    this.stmts = {};
    this.entityLineage = new Map();
    this.atomLineage = new Map();
    this.atomScripts = new Map();
    this.entityScripts = new Map();
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
    return [
      ...[...this.atomScripts].map(([name, src]) => ({
        kind: 'atom' as const,
        name,
        src
      })),
      ...[...this.entityScripts].map(([eid, src]) => ({
        eid,
        kind: 'entity' as const,
        src
      }))
    ];
  }

  /**
   * Record the base atoms an atom extends, and save them, so a world opened
   * from its database knows them without running its EDL again.
   */
  setAtomLineage(name: string, bases: string[]) {
    this.atomLineage.set(name, [...bases]);
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_lineage (kind, name, bases) VALUES (?1, ?2, ?3)',
      ['atom', name, JSON.stringify(bases)]
    );
  }

  /** Record, and save, the base atoms an entity was built from */
  setEntityLineage(eid: number, bases: string[]) {
    this.entityLineage.set(eid, [...bases]);
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_lineage (kind, name, bases) VALUES (?1, ?2, ?3)',
      ['entity', String(eid), JSON.stringify(bases)]
    );
  }

  /** Record, and save, the Script an atom (by name) or entity (by id) owns */
  setScriptOwner(kind: 'atom' | 'entity', name: string | number, src: string) {
    if (kind === 'atom') {
      this.atomScripts.set(String(name), src);
    } else {
      this.entityScripts.set(Number(name), src);
    }
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_script_owner (kind, name, src) VALUES (?1, ?2, ?3)',
      [kind, String(name), src]
    );
  }

  /** Record, and save, the Definition name an entity was given in the EDL */
  setDefinitionName(name: string, eid: number) {
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_definition_name (name, eid) VALUES (?1, ?2)',
      [name, eid]
    );
  }

  /** Forget a Definition name, once its entity is out of play */
  deleteDefinitionName(name: string) {
    this.db.exec('DELETE FROM tbl_definition_name WHERE name = ?1', [name]);
  }

  /** Each Definition name the EDL gave, with the id of its entity */
  getDefinitionNames(): Map<string, number> {
    const rows = this.db.query('SELECT name, eid FROM tbl_definition_name') as {
      eid: number;
      name: string;
    }[];
    return new Map(rows.map(({ eid, name }) => [name, eid]));
  }

  /** Save a Play state component's value as the EDL last set it */
  setEDLValue(eid: number, component: string, value: string) {
    this.db.exec(
      'INSERT OR REPLACE INTO tbl_edl_value (eid, component, value) VALUES (?1, ?2, ?3)',
      [eid, component, value]
    );
  }

  /** Each Play state component's value as the EDL last set it */
  getEDLValues(eid: number): Map<string, string> {
    const rows = this.db.query(
      'SELECT component, value FROM tbl_edl_value WHERE eid = ?1',
      [eid]
    ) as { component: string; value: string }[];
    return new Map(rows.map(({ component, value }) => [component, value]));
  }

  /** Forget the values the EDL last set on an entity */
  deleteEDLValues(eid: number) {
    this.db.exec('DELETE FROM tbl_edl_value WHERE eid = ?1', [eid]);
  }

  /** Save the hash of the EDL the world was last built or migrated from */
  setEDLHash(hash: string) {
    this.db.exec(
      "INSERT OR REPLACE INTO tbl_edl (key, value) VALUES ('hash', ?1)",
      [hash]
    );
  }

  /** The hash of the EDL the world was last built or migrated from */
  getEDLHash(): string | undefined {
    const rows = this.db.query(
      "SELECT value FROM tbl_edl WHERE key = 'hash'"
    ) as { value: string }[];
    return rows[0]?.value;
  }

  /** Forget the saved Lineage and Script owners of every atom */
  clearAtoms() {
    this.atomLineage.clear();
    this.atomScripts.clear();
    this.db.exec("DELETE FROM tbl_lineage WHERE kind = 'atom'");
    this.db.exec("DELETE FROM tbl_script_owner WHERE kind = 'atom'");
  }

  /** Forget the Script an entity owns */
  deleteEntityScriptOwner(eid: number) {
    this.entityScripts.delete(eid);
    this.db.exec(
      "DELETE FROM tbl_script_owner WHERE kind = 'entity' AND name = ?1",
      [String(eid)]
    );
  }

  /** The ordered base atoms an entity was built from (empty if none) */
  getEntityLineage(eid: number): string[] {
    return [...(this.entityLineage.get(eid) ?? [])];
  }

  /** The ordered base atoms an atom extends, or undefined if no such atom */
  getAtomLineage(name: string): string[] | undefined {
    const lineage = this.atomLineage.get(name);
    return lineage ? [...lineage] : undefined;
  }

  async open() {
    // If already open, do nothing (idempotent)
    if (this.db) {
      return;
    }

    this.db = await createDatabase({
      ...this.options,
      path: this.options.path || ':memory:',
      type: this.options.dbType || DatabaseType.BUN
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

    // Create new entity
    const newEid = this.db.addEntity();

    // Clone component rows using SQL
    this.db.transaction(() => {
      for (const [componentName, def] of this.defs.entries()) {
        // Check if source entity has this component
        const hasComponent =
          this.db.query(
            `SELECT 1 FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`,
            sourceEid
          ).length > 0;

        if (hasComponent) {
          // Query the source component data
          const sourceRows = this.db.query(
            `SELECT * FROM ${def.tableName} WHERE eid = ?`,
            sourceEid
          );
          if (sourceRows.length > 0) {
            const sourceRow = sourceRows[0] as Record<string, unknown>;

            // Create new data with new eid
            const newData: Record<string, unknown> = {
              ...sourceRow,
              eid: newEid
            };
            delete newData.id; // Remove id so it gets auto-increment

            // Only keep the columns that the insert statement expects
            const expectedColumns = def.columns
              .filter(col => col.name !== 'id')
              .map(col => col.name);

            const insertData: Record<string, unknown> = {};
            for (const col of expectedColumns) {
              if (col in newData) {
                insertData[col] = newData[col];
              }
            }

            // Use the existing prepared statement to insert
            def.stmtInsert.run(insertData);
          }
        }
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

    // SQL-based copy of components from source -> target
    this.db.transaction(() => {
      for (const [, def] of this.defs) {
        // Only operate if source has rows for this component
        const hasSource =
          this.db.query(
            `SELECT 1 FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`,
            sourceEid
          ).length > 0;
        if (!hasSource) {
          continue;
        }

        // Overwrite target rows for this component
        this.db.exec(`DELETE FROM ${def.tableName} WHERE eid = ?1`, targetEid);

        // Build INSERT ... SELECT excluding id column
        const cols = def.columns.map(c => c.name).filter(n => n !== 'id');
        const insertCols = cols.join(', ');
        const selectCols = cols.map(n => (n === 'eid' ? '?1' : n)).join(', ');
        const sql = `INSERT INTO ${def.tableName} (${insertCols}) SELECT ${selectCols} FROM ${def.tableName} WHERE eid = ?2`;
        this.db.exec(sql, targetEid, sourceEid);
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
   * @returns The entity instance or null if the entity does not exist
   */
  get(id: number): GenericEntity<TComponents> | null {
    // return this.entityCache.get(eid)! as EntityWithComponents<TComponents, keyof TComponents>;
    const stmt = this.stmts.selectEntityById;
    if (!stmt) {
      throw createWorldNotInitializedError();
    }
    const eid = stmt.get(id) as { id: number } | null;

    return eid
      ? ({ id: eid.id, world: this } as GenericEntity<TComponents>)
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
   * Create a system instance bound to this world so `exec` does not require a `world` arg.
   * The returned system remains compatible with the standard System type.
   */
  // createSystem<
  //   TExecProps extends { deltaTime: number } = { deltaTime: number }
  // >(
  //   processFn: (props: TExecProps) => void,
  //   options: QueryOptions<TComponents> & {
  //     enabled?: boolean;
  //     frequency?: number;
  //     priority?: number;
  //   } = {}
  // ) {
  //   const hasQuery =
  //     options.with !== undefined ||
  //     options.without !== undefined ||
  //     options.where !== undefined ||
  //     options.entity !== undefined;

  //   const exec = (props: {
  //     deltaTime: number;
  //     flushOnExec?: boolean;
  //     world?: World<TComponents>;
  //   }) => {
  //     const { deltaTime, flushOnExec = true } = props;
  //     const world = this as World<TComponents>;

  //     if (hasQuery) {
  //       using entities = queryEntitiesIterator(
  //         world,
  //         options as QueryOptions<TComponents>
  //       );
  //       for (const entity of entities) {
  //         // Provide entity + bound world
  //         processFn({ deltaTime, entity, world } as unknown as TExecProps);
  //       }
  //     } else {
  //       // Provide bound world only
  //       processFn({ deltaTime, world } as unknown as TExecProps);
  //     }

  //     if (flushOnExec) {
  //       world.flush();
  //     }
  //   };

  //   return {
  //     ...options,
  //     exec
  //   };
  // }

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
      if (entitiesToDelete.size > 0) {
        const entityIds = Array.from(entitiesToDelete);
        const placeholders = entityIds
          .map((_, index) => `?${index + 1}`)
          .join(',');
        const deleteSql = `DELETE FROM tbl_entity WHERE id IN (${placeholders})`;

        db.exec(deleteSql, entityIds);

        for (const eid of entityIds) {
          entityCache.delete(eid);
          dirtyEntities.delete(eid);
          this.dirtyEntities.delete(eid);
        }
      }

      // Handle component updates and insertions
      for (const [eid, components] of dirtyEntities.entries()) {
        if (!entityCache.has(eid)) {
          continue;
        }

        const cache = entityCache.get(eid);

        for (const c of components) {
          const entry = cache![c as string]!;
          const def = defs.get(c as string);
          if (!def) {
            throw createComponentNotFoundError(c as string, eid);
          }

          if (entry.exists === false && entry.data === null) {
            continue;
          }

          // The cache may not know about a row it never loaded, so check the
          // table before inserting: an entity has at most one row per component.
          if (!entry.exists && def.stmtExists.get([eid])) {
            entry.exists = true;
          }

          if (entry.exists) {
            // update
            const { id, ...dataWithoutId } = entry.data as Record<
              string,
              unknown
            >;
            const updateData = serializeValues(
              convertKeysToSnakeCase({ ...dataWithoutId, eid })
            );

            // Ensure all named params for UPDATE are present (bind null for missing)
            // cdefToSqlUpdate uses all non-id, non-eid columns in SET and :eid in WHERE
            for (const col of def.columns) {
              const name = col.name;
              if (name === 'id' || name === 'eid') {
                continue;
              }
              if (!(name in updateData)) {
                updateData[name] = null;
              }
            }
            def!.stmtUpdate.run(updateData);
          } else {
            // insert
            const { id, ...dataWithoutId } = entry.data as Record<
              string,
              unknown
            >;
            const insertData = serializeValues(
              convertKeysToSnakeCase({ ...dataWithoutId, eid })
            );

            // Ensure all named params for INSERT are present (bind null for missing)
            // cdefToSqlInsert uses all columns except id
            for (const col of def.columns) {
              const name = col.name;
              if (name === 'id') {
                continue;
              }
              if (!(name in insertData)) {
                insertData[name] = null;
              }
            }

            def!.stmtInsert.run(insertData);
            entry.exists = true;
          }
        }
      }

      // Handle deferred component deletions
      for (const [eid, components] of dirtyEntities.entries()) {
        if (!entityCache.has(eid)) {
          continue;
        }

        const cache = entityCache.get(eid);
        if (!cache) {
          continue;
        }

        for (const c of components) {
          const entry = cache[c as string];
          if (entry && entry.exists === false && entry.data === null) {
            const def = defs.get(c as string);
            if (def) {
              db.exec(`DELETE FROM ${def.tableName} WHERE eid = ?1`, eid);
              delete cache[c as string];
            }
          }
        }
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
    // Execute entity/atom definitions and commands to populate initial data
    executeEDL(world, componentDefs);
    return world;
  }

  const world = new World(options || {});
  await world.open();
  await initialiseWorldDb(world, componentDefs, options);
  return world;
}

/** Reads the saved Lineage and Script owners into the world's maps */
const loadLineage = <TComponents extends Components>(
  world: World<TComponents>
) => {
  const lineage = world.db.query(
    'SELECT kind, name, bases FROM tbl_lineage'
  ) as { bases: string; kind: string; name: string }[];
  for (const { bases, kind, name } of lineage) {
    const parsed = JSON.parse(bases) as string[];
    if (kind === 'atom') {
      world.atomLineage.set(name, parsed);
    } else {
      world.entityLineage.set(Number(name), parsed);
    }
  }
  const owners = world.db.query(
    'SELECT kind, name, src FROM tbl_script_owner'
  ) as { kind: string; name: string; src: string }[];
  for (const { kind, name, src } of owners) {
    if (kind === 'atom') {
      world.atomScripts.set(name, src);
    } else {
      world.entityScripts.set(Number(name), src);
    }
  }
};

const initialiseWorldDb = async <TComponents extends Components>(
  world: World<TComponents>,
  componentDefs: readonly CDef[],
  options?: CreateWorldOptions
) => {
  if (!world.db) {
    throw new Error('Database not open');
  }
  const allowRedefineDefinitions = options?.allowRedefineDefinitions ?? true;

  world.db.exec('PRAGMA foreign_keys = ON');

  const sysSql = `CREATE TABLE IF NOT EXISTS tbl_ecs (version TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP); 
   INSERT INTO tbl_ecs (version) VALUES ('1.0');`;
  world.db.exec(sysSql);

  // Create entity table
  const sql =
    'CREATE TABLE IF NOT EXISTS tbl_entity (id INTEGER PRIMARY KEY AUTOINCREMENT)';
  world.db.exec(sql);

  // Lineage and Script owners, recorded by EDL, and loaded back on open
  world.db.exec(
    `CREATE TABLE IF NOT EXISTS tbl_lineage (kind TEXT NOT NULL, name TEXT NOT NULL, bases TEXT NOT NULL, PRIMARY KEY (kind, name))`
  );
  world.db.exec(
    `CREATE TABLE IF NOT EXISTS tbl_script_owner (kind TEXT NOT NULL, name TEXT NOT NULL, src TEXT NOT NULL, PRIMARY KEY (kind, name))`
  );
  // Definition names and the EDL's hash, recorded by EDL, for migrations
  world.db.exec(
    `CREATE TABLE IF NOT EXISTS tbl_definition_name (name TEXT PRIMARY KEY, eid INTEGER NOT NULL)`
  );
  world.db.exec(
    `CREATE TABLE IF NOT EXISTS tbl_edl (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );
  // Play state components as the EDL last set them (ADR 0006)
  world.db.exec(
    `CREATE TABLE IF NOT EXISTS tbl_edl_value (eid INTEGER NOT NULL, component TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (eid, component))`
  );
  loadLineage(world);

  // Initialize component metadata table for compatibility checking
  initializeComponentMetadataTable(world.db);

  // Validate component compatibility
  const validation = validateComponentCompatibility(
    world.db,
    [...componentDefs],
    { allowRedefineDefinitions }
  );

  // console.log('validation', validation);

  if (!validation.compatible) {
    const errorMessage = [
      'Component definition compatibility check failed:',
      ...validation.errors,
      '',
      'This usually means the component definitions in your code have changed',
      'in a way that is incompatible with the existing database.',
      '',
      'To resolve this:',
      '1. Update your component definitions to match the existing schema, or',
      '2. Create a new database file'
    ].join('\n');

    throw new Error(errorMessage);
  }

  // Log warnings if any
  if (validation.warnings.length > 0) {
    // log.warn('Component definition warnings:');
    // validation.warnings.forEach(warning => log.warn(`  ${warning}`));
  }

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

      // Update component metadata after successful registration
      updateComponentMetadata(world.db, [...componentDefs]);
    });
  }

  if (!world.db) {
    throw new Error('Database not open');
  }

  const deleteEntity = world.db.prepare('DELETE FROM tbl_entity WHERE id = ?;');
  const selectEntityById = world.db.prepare(
    'SELECT id FROM tbl_entity WHERE id = ?;'
  );

  world.componentTypes = componentDefs.map(
    def => def.id
  ) as (keyof TComponents)[];
  world.stmts = {
    deleteEntity,
    selectEntityById
  };
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

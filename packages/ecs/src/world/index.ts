import { createLog } from 'odgn-helpers/log';

import {
  DatabaseType,
  createDatabase,
  type CreateDatabaseOptions,
  type Database,
  type LoadFromJSONOptions,
  type SaveToJSONOptions,
  type Statement
} from '@db';
import { executeEDL, type ExecuteOptions } from '@edl';
import { convertKeysToSnakeCase } from '@helpers/convert-keys';
import {
  initializeComponentMetadataTable,
  updateComponentMetadata,
  validateComponentCompatibility
} from '@schema/component-metadata';

import {
  addComponent,
  applyComponentDefaults,
  makeTrackedComponent,
  removeComponent,
  toTableName
} from '../component';
import {
  loadFromJSON as sharedLoadFromJSON,
  saveToJSON as sharedSaveToJSON
} from '../db/json-functions';
import { parseDefsFromEDL } from '../edl/helpers';
import {
  queryEntities,
  queryEntitiesIterator,
  queryEntity,
  type QueryOptions
} from '../entity';
import { createDuplicateComponentDefinitionError } from '../error';
import {
  cdefToSqlCreate,
  cdefToSqlInsert,
  cdefToSqlUpdate
} from '../schema/cdef-to-sql';
import type {
  CDef,
  ComponentDef,
  Components,
  EntityCache,
  EntityWithComponents,
  GenericEntity,
  InferComponentsFromCDefs
} from '../types';

const log = createLog('world');

// Create a Proxy wrapper around an entity object that intercepts
// component add/remove via property assignment.
const proxyEntity = <T extends Components>(world: World<T>, entity: any) =>
  new Proxy(entity, {
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
          addComponent(target, propName as any, value);
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
          removeComponent(target, propName as any);
          return true;
        }
      }

      // Fallback to normal set
      (target as any)[prop] = value;
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
    stmtInsert: world.db.prepare(sqlInsert),
    stmtUpdate: world.db.prepare(sqlUpdate),
    tableName: result.tableName,
    url: componentDef.id!,
    ...additionalStmts
  } as ComponentDef;

  world.defs.set(name, def);
};

export class World<TComponents extends Components> {
  db!: Database;
  options: CreateWorldOptions;

  componentTypes: (keyof TComponents)[];
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entitiesToDelete: Set<number>;
  entityCache: EntityCache<TComponents>;
  defs: Map<string, ComponentDef>;
  stmts: Record<string, Statement>;

  constructor(options: CreateWorldOptions) {
    this.options = options;
    this.componentTypes = [];
    this.dirtyEntities = new Map<number, Set<keyof TComponents>>();
    this.entitiesToDelete = new Set<number>();
    this.entityCache = new Map();
    this.defs = new Map<string, ComponentDef>();
    this.stmts = {};
  }

  async open() {
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

  create(
    initialComponents?: Partial<TComponents>
  ): EntityWithComponents<TComponents, keyof TComponents> {
    const eid = this.db.addEntity();

    const entity: any = { id: eid, world: this };

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

  clone(
    entity: EntityWithComponents<TComponents, keyof TComponents>
  ): EntityWithComponents<TComponents, keyof TComponents> {}

  get(id: number): GenericEntity<TComponents> | null {
    // return this.entityCache.get(eid)! as EntityWithComponents<TComponents, keyof TComponents>;
    const stmt = this.stmts.selectEntityById;
    if (!stmt) {
      throw new Error('selectEntityById not found');
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
  query<W extends readonly (keyof TComponents)[]>(
    options: QueryOptions<TComponents> & { with: W }
  ) {
    return queryEntity(this, options);
  }

  /**
   * Query multiple entities
   * @param options
   * @returns
   */
  queryAll(
    options?: QueryOptions<TComponents> & { with?: (keyof TComponents)[] }
  ) {
    return queryEntities(this, options);
  }

  /**
   * Query an iterator over the entities
   * @param options
   * @returns
   */
  queryIterator(
    options: QueryOptions<TComponents> & { with: (keyof TComponents)[] }
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
    const { db, defs, dirtyEntities, entitiesToDelete, entityCache } = this;

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
            throw new Error(`Component def not found for ${c as string}`);
          }

          if (entry.exists === false && entry.data === null) {
            continue;
          }

          const serializeValues = (obj: Record<string, unknown>) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) {
              if (v === null || v === undefined) {
                out[k] = v as any;
                continue;
              }
              if (v instanceof Date) {
                out[k] = v.toISOString();
                continue;
              }
              if (typeof v === 'object') {
                out[k] = JSON.stringify(v);
                continue;
              }
              out[k] = v as any;
            }
            return out;
          };

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
                (updateData as any)[name] = null;
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
                (insertData as any)[name] = null;
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

    // Clear all tracking
    dirtyEntities.clear();
    entitiesToDelete.clear();

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
    return world as any;
  }

  const world = new World(options || {});
  await world.open();
  await initialiseWorldDb(world, componentDefs, options);
  return world as any;
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

  world.db.exec('PRAGMA foreign_keys = ON');

  const sysSql = `CREATE TABLE IF NOT EXISTS tbl_ecs (version TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP); 
   INSERT INTO tbl_ecs (version) VALUES ('1.0');`;
  world.db.exec(sysSql);

  // Create entity table
  const sql =
    'CREATE TABLE IF NOT EXISTS tbl_entity (id INTEGER PRIMARY KEY AUTOINCREMENT)';
  world.db.exec(sql);

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
    log.warn('Component definition warnings:');
    validation.warnings.forEach(warning => log.warn(`  ${warning}`));
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
  return world as any;
};

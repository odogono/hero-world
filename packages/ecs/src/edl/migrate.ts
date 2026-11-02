import { toCamelCase } from 'odgn-helpers/string';

import { addComponents } from '../component';
import { applyComponentDefaults } from '../component/defaults';
import { removeComponent } from '../component/remove';
import type { Components, GenericEntity } from '../types';
import type { World } from '../world';
import {
  compileEDL,
  hashEDL,
  resolveEDL,
  scriptPath,
  type CompiledEDL,
  type ComponentData
} from './compile';
import { EDLExecutionError } from './errors';

export type MigrateOptions = {
  /** Report what would change without changing anything */
  dryRun?: boolean;
  /** Path of the .edl file; `script.src` values resolve relative to it */
  path?: string;
  /**
   * Takes an entity gone from the EDL out of play, e.g. by moving it to
   * Limbo. Without it, such entities are only reported.
   */
  prune?: (eid: number) => void;
};

/** How one entity already in the world changes */
export type EntityMigration = {
  /** Components the entity lacks and the EDL now gives it */
  added: string[];
  /** Static components the EDL now sets differently */
  changed: string[];
  eid: number;
  /** Its bases, when they changed */
  lineage?: { from: string[]; to: string[] };
  name: string;
  /** Static components the EDL no longer gives it */
  removed: string[];
};

/** What a migration does, or would do on a dry run */
export type MigrationPlan = {
  atoms: { added: string[]; changed: string[]; removed: string[] };
  /** Definition names new in the EDL, whose entities are created */
  created: string[];
  /** Entities whose Definition name is gone from the EDL */
  gone: { eid: number; name: string }[];
  /** Entities deleted during play; the EDL doesn't bring them back */
  missing: { eid: number; name: string }[];
  /** Whether `gone` entities were taken out of play */
  pruned: boolean;
  updated: EntityMigration[];
};

/** Whether the EDL differs from the one the world was built or migrated from */
export const isEDLChanged = <T extends Components>(
  world: World<T>,
  edl: string
) => world.getEDLHash() !== hashEDL(edl);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

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
const normalise = <T extends Components>(
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

/** Applies `!set $entity.component.prop value` commands to the components */
const applySetCommands = (
  compiled: CompiledEDL,
  components: ComponentData[],
  ids: readonly number[]
) => {
  const indexByName = new Map<string, number>();
  for (const [i, entity] of compiled.entities.entries()) {
    if (entity.name) {
      indexByName.set(entity.name, i);
    }
  }
  const toValue = (raw: string): unknown => {
    if (raw === 'true' || raw === 'false') {
      return raw === 'true';
    }
    if (raw === 'null') {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      return Number(raw);
    }
    if (raw.startsWith('$') && !raw.includes('.')) {
      const index = indexByName.get(raw.slice(1));
      return index === undefined ? raw : ids[index];
    }
    return raw;
  };
  for (const { name, rawArgs } of compiled.commands) {
    const [target, rawValue] = rawArgs;
    if (name !== '!set' || !target?.startsWith('$') || rawValue === undefined) {
      continue;
    }
    const [entityName = '', component = '', prop] = target.slice(1).split('.');
    const index = indexByName.get(entityName);
    if (index === undefined || !component || !prop) {
      continue;
    }
    const data = components[index]!;
    data[component] = {
      ...data[component],
      [toCamelCase(prop)]: toValue(rawValue)
    };
  }
};

/**
 * Brings a world up to date with a changed EDL (ADR 0005). New entities
 * are created; entities already in play get their static components set to
 * what the EDL now says, while Play state components are only added, never
 * overwritten. Entities gone from the EDL are reported, and taken out of
 * play only by `options.prune`.
 *
 * Only `!set` commands are applied; other EDL commands are not re-run.
 */
export const migrateEDL = <T extends Components>(
  world: World<T>,
  edl: string,
  options: MigrateOptions = {}
): MigrationPlan => {
  const { dryRun = false, path, prune } = options;
  const compiled = compileEDL(edl);
  const named = compiled.entities.filter(entity => entity.name);
  const stored = world.getDefinitionNames();

  const plan: MigrationPlan = {
    atoms: { added: [], changed: [], removed: [] },
    created: [],
    gone: [],
    missing: [],
    pruned: false,
    updated: []
  };

  // Atoms
  const edlAtoms = compiled.atoms;
  for (const [name, atom] of edlAtoms) {
    const lineage = world.getAtomLineage(name);
    if (lineage === undefined) {
      plan.atoms.added.push(name);
    } else if (!sameList(lineage, atom.extends)) {
      plan.atoms.changed.push(name);
    }
  }
  for (const name of world.atomLineage.keys()) {
    if (!edlAtoms.has(name)) {
      plan.atoms.removed.push(name);
    }
  }

  // Match each EDL entity to the entity it made, if it is still in play
  const existing = new Map<string, number>();
  for (const { name } of named) {
    const eid = stored.get(name!);
    if (eid === undefined) {
      plan.created.push(name!);
    } else if (world.get(eid)) {
      existing.set(name!, eid);
    } else {
      plan.missing.push({ eid, name: name! });
    }
  }
  const edlNames = new Set(named.map(entity => entity.name!));
  for (const [name, eid] of stored) {
    if (!edlNames.has(name)) {
      plan.gone.push({ eid, name });
    }
  }

  // Entities to create get placeholder ids until they are made
  const missingNames = new Set(plan.missing.map(({ name }) => name));
  const created = new Map<string, number>();
  let placeholder = -1;
  const idsFor = () =>
    compiled.entities.map(({ name }) =>
      name && existing.has(name)
        ? existing.get(name)!
        : name && created.has(name)
          ? created.get(name)!
          : placeholder--
    );

  if (!dryRun) {
    for (const name of plan.created) {
      created.set(name, world.create().id);
    }
  }

  const ids = idsFor();
  const resolved = resolveEDL(compiled, ids);
  if (resolved.errors.length > 0) {
    throw new EDLExecutionError(resolved.errors);
  }
  const { components } = resolved;
  applySetCommands(compiled, components, ids);

  // Work out, and unless this is a dry run make, each entity's changes
  for (const [i, def] of compiled.entities.entries()) {
    const { name } = def;
    if (!name || missingNames.has(name)) {
      continue;
    }
    const desired = components[i]!;
    const eid = ids[i]!;

    if (created.has(name) || !existing.has(name)) {
      if (!dryRun) {
        const entity = world.get(eid)! as GenericEntity<T>;
        addComponents(entity as Parameters<typeof addComponents>[0], desired);
        world.setEntityLineage(eid, def.extends);
        world.setDefinitionName(name, eid);
        const src = scriptPath(def.own, path);
        if (src) {
          world.setScriptOwner('entity', eid, src);
        }
      }
      continue;
    }

    const current = (world.query({
      asProxy: false,
      entity: { id: eid, world } as GenericEntity<T>,
      maybe: [...world.defs.keys()] as (keyof T)[]
    }) ?? {}) as Record<string, Record<string, unknown> | undefined>;

    const change: EntityMigration = {
      added: [],
      changed: [],
      eid,
      name,
      removed: []
    };
    for (const [component, data] of Object.entries(desired)) {
      const now = current[component];
      if (!now) {
        change.added.push(component);
      } else if (
        !world.defs.get(component)?.schema.playState &&
        normalise(world, component, data) !== normalise(world, component, now)
      ) {
        change.changed.push(component);
      }
    }
    for (const component of world.defs.keys()) {
      if (
        current[component] &&
        !(component in desired) &&
        !world.defs.get(component)?.schema.playState
      ) {
        change.removed.push(component);
      }
    }
    const lineage = world.getEntityLineage(eid);
    if (!sameList(lineage, def.extends)) {
      change.lineage = { from: lineage, to: [...def.extends] };
    }

    const isChanged =
      change.added.length + change.changed.length + change.removed.length > 0 ||
      change.lineage;
    if (!isChanged) {
      continue;
    }
    plan.updated.push(change);

    if (!dryRun) {
      const entity = world.query({
        entity: { id: eid, world } as GenericEntity<T>,
        maybe: [...world.defs.keys()] as (keyof T)[]
      })! as GenericEntity<T>;
      // Adding a component the entity has replaces it whole
      addComponents(
        entity as Parameters<typeof addComponents>[0],
        Object.fromEntries(
          [...change.added, ...change.changed].map(c => [c, desired[c]])
        )
      );
      for (const component of change.removed) {
        removeComponent(entity, component as keyof T);
      }
      if (change.lineage) {
        world.setEntityLineage(eid, def.extends);
      }
    }
  }

  if (dryRun) {
    return plan;
  }

  // Atoms' Lineage and Script owners are rewritten from the EDL
  world.clearAtoms();
  for (const [name, atom] of edlAtoms) {
    world.setAtomLineage(name, atom.extends);
    const src = scriptPath(atom.own, path);
    if (src) {
      world.setScriptOwner('atom', name, src);
    }
  }
  for (const [i, def] of compiled.entities.entries()) {
    const eid = ids[i]!;
    if (def.name && existing.has(def.name)) {
      world.deleteEntityScriptOwner(eid);
      const src = scriptPath(def.own, path);
      if (src) {
        world.setScriptOwner('entity', eid, src);
      }
    }
  }

  if (prune) {
    for (const { eid, name } of plan.gone) {
      prune(eid);
      world.deleteDefinitionName(name);
    }
    plan.pruned = plan.gone.length > 0;
  }

  world.setEDLHash(hashEDL(edl));
  world.flush();
  return plan;
};

/**
 * Gives a world built before Definition names were saved the names from
 * the EDL it was first built with. That EDL made its entities first and in
 * order, so the nth entity it defines is the world's nth entity. The
 * world's hash is set to that EDL's, so a later migration sees what changed.
 */
export const adoptDefinitionNames = <T extends Components>(
  world: World<T>,
  originalEDL: string
): Map<string, number> => {
  if (world.getDefinitionNames().size > 0) {
    throw new Error('The world already has Definition names');
  }
  const { entities } = compileEDL(originalEDL);
  const rows = world.db.query(
    'SELECT id FROM tbl_entity ORDER BY id LIMIT ?1',
    [entities.length]
  ) as { id: number }[];
  const first = rows[0]?.id ?? 1;
  const adopted = new Map<string, number>();
  for (const [i, { name }] of entities.entries()) {
    const eid = first + i;
    if (!name) {
      continue;
    }
    if (rows[i]?.id !== eid) {
      throw new Error(
        `Entity ${eid} for '${name}' is not in the world; is this the EDL it was built with?`
      );
    }
    adopted.set(name, eid);
  }
  for (const [name, eid] of adopted) {
    world.setDefinitionName(name, eid);
  }
  world.setEDLHash(hashEDL(originalEDL));
  return adopted;
};

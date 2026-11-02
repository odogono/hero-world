import { addComponents } from '../component';
import { removeComponent } from '../component/remove';
import type { Components, GenericEntity } from '../types';
import type { World } from '../world';
import { compileEDL, hashEDL, resolveEDL, scriptPath } from './compile';
import {
  isPlayState,
  normalise,
  readComponents,
  recordEDLValues
} from './edl-values';
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
  /**
   * Components the EDL now sets differently: static ones, and Play state
   * that play hasn't changed since the EDL last set it
   */
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
  /**
   * Play state components the EDL sets differently from the world, left as
   * they are because play changed them, or because the world doesn't know
   * what the EDL last set (it was built before that was saved)
   */
  kept: { components: string[]; eid: number; name: string }[];
  /** Entities deleted during play; the EDL doesn't bring them back */
  missing: { eid: number; name: string }[];
  /** Whether `gone` entities were taken out of play */
  pruned: boolean;
  /**
   * Entities whose Definition name the EDL changed (`entity b was a`);
   * they keep their id and state
   */
  renamed: { eid: number; from: string; to: string }[];
  updated: EntityMigration[];
};

/** Whether the EDL differs from the one the world was built or migrated from */
export const isEDLChanged = <T extends Components>(
  world: World<T>,
  edl: string
) => world.getEDLHash() !== hashEDL(edl);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Brings a world up to date with a changed EDL (ADR 0005). New entities
 * are created; entities already in play get their static components set to
 * what the EDL now says, while Play state components are only added, never
 * overwritten. Entities gone from the EDL are reported, and taken out of
 * play only by `options.prune`.
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
    kept: [],
    missing: [],
    pruned: false,
    renamed: [],
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
  const edlNames = new Set(named.map(entity => entity.name!));
  const existing = new Map<string, number>();
  for (const { name, was } of named) {
    let eid = stored.get(name!);
    if (eid === undefined && was !== undefined) {
      if (edlNames.has(was)) {
        throw new Error(
          `'${name}' was '${was}', but the EDL still defines '${was}'`
        );
      }
      eid = stored.get(was);
      if (eid !== undefined) {
        plan.renamed.push({ eid, from: was, to: name! });
        stored.delete(was);
        stored.set(name!, eid);
      }
    }
    if (eid === undefined) {
      plan.created.push(name!);
    } else if (world.get(eid)) {
      existing.set(name!, eid);
    } else {
      plan.missing.push({ eid, name: name! });
    }
  }
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

    const current = readComponents(world, eid);
    const edlValues = world.getEDLValues(eid);

    const change: EntityMigration = {
      added: [],
      changed: [],
      eid,
      name,
      removed: []
    };
    const kept: string[] = [];
    for (const [component, data] of Object.entries(desired)) {
      const now = current[component];
      if (!now) {
        change.added.push(component);
      } else {
        const stored = normalise(world, component, now);
        if (normalise(world, component, data) === stored) {
          continue;
        }
        // Play state is set only when play left it as the EDL last set it
        const untouched = edlValues.get(component) === stored;
        (isPlayState(world, component) && !untouched
          ? kept
          : change.changed
        ).push(component);
      }
    }
    for (const component of world.defs.keys()) {
      if (
        current[component] &&
        !(component in desired) &&
        !isPlayState(world, component)
      ) {
        change.removed.push(component);
      }
    }
    if (kept.length > 0) {
      plan.kept.push({ components: kept, eid, name });
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

  // What the EDL now sets is what later migrations compare play against
  for (const [i, { name }] of compiled.entities.entries()) {
    if (name && !missingNames.has(name)) {
      recordEDLValues(world, ids[i]!, components[i]!);
    }
  }

  for (const { eid, from, to } of plan.renamed) {
    world.deleteDefinitionName(from);
    world.setDefinitionName(to, eid);
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

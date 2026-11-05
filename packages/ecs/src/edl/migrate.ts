import { addComponents } from '../component';
import { removeComponent } from '../component/remove';
import type { Components, GenericEntity } from '../types';
import type { World } from '../world';
import { compileNodes, hashEDL, resolveEDL, scriptPath } from './compile';
import {
  edlValues,
  isPlayState,
  normalise,
  readComponents
} from './edl-values';
import { EDLExecutionError } from './errors';
import { readEDL, type ReadOptions } from './includes';
import { edlRecord } from './record';

export type MigrateOptions = ReadOptions & {
  /** Report what would change without changing anything */
  dryRun?: boolean;
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
   * Components the EDL now sets differently, which the world still held as
   * the EDL last set them
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
   * Components the EDL sets differently from the world, left as they are
   * because they changed since the EDL last set them, or, for Play state,
   * because the world doesn't know what the EDL last set (it was built
   * before that was saved)
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

/**
 * Whether the EDL, with the files it includes, differs from the one the
 * world was built or migrated from
 */
export const isEDLChanged = <T extends Components>(
  world: World<T>,
  edl: string,
  options: ReadOptions = {}
) => edlRecord(world).getEDLHash() !== hashEDL(readEDL(edl, options).source);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Brings a world up to date with a changed EDL (ADR 0005, 0008). New
 * entities are created; entities already in play get each component the
 * EDL now sets, unless it changed since the EDL last set it, in which case
 * it is kept and reported. Static components the EDL no longer sets are
 * removed; Play state ones stay. Entities gone from the EDL are reported,
 * and taken out of play only by `options.prune`.
 */
export const migrateEDL = <T extends Components>(
  world: World<T>,
  edl: string,
  options: MigrateOptions = {}
): MigrationPlan => migrate(world, edl, options);

/**
 * A Migration, or with `build` a Build: the Migration of an empty world,
 * which also makes the EDL's entities that have no Definition name
 */
export const migrate = <T extends Components>(
  world: World<T>,
  edl: string,
  options: MigrateOptions & { build?: boolean } = {}
): MigrationPlan => {
  const { build = false, dryRun = false, path, prune } = options;
  const record = edlRecord(world);
  const { nodes, source } = readEDL(edl, options);
  const compiled = compileNodes(nodes);
  const named = compiled.entities.filter(entity => entity.name);
  const stored = record.getDefinitionNames();

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
    const lineage = record.getAtomLineage(name);
    if (lineage === undefined) {
      plan.atoms.added.push(name);
    } else if (!sameList(lineage, atom.extends)) {
      plan.atoms.changed.push(name);
    }
  }
  for (const name of record.atomNames()) {
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

  // Entities are made in EDL order, so a Build numbers them in that order;
  // on a dry run they get placeholder ids instead
  const missingNames = new Set(plan.missing.map(({ name }) => name));
  const toCreate = new Set(plan.created);
  const created = new Map<number, number>();
  if (!dryRun) {
    for (const [i, { name }] of compiled.entities.entries()) {
      if (name ? toCreate.has(name) : build) {
        created.set(i, world.create().id);
      }
    }
  }
  let placeholder = -1;
  const ids = compiled.entities.map(({ name }, i) =>
    name && existing.has(name)
      ? existing.get(name)!
      : (created.get(i) ?? placeholder--)
  );
  const resolved = resolveEDL(compiled, ids);
  if (resolved.errors.length > 0) {
    throw new EDLExecutionError(resolved.errors);
  }
  const { components } = resolved;

  // Work out, and unless this is a dry run make, each entity's changes
  for (const [i, def] of compiled.entities.entries()) {
    const { name } = def;
    const desired = components[i]!;
    const eid = ids[i]!;

    if (created.has(i)) {
      const entity = world.get(eid)! as GenericEntity<T>;
      addComponents(entity as Parameters<typeof addComponents>[0], desired);
      record.setEntityLineage(eid, def.extends);
      record.setEntityScript(eid, scriptPath(def.own, path));
      if (name) {
        record.setDefinitionName(name, eid);
      }
      continue;
    }
    if (!name || !existing.has(name)) {
      continue;
    }

    const current = readComponents(world, eid);
    const lastSet = record.getEDLValues(eid);

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
        // A component is set only where the world still holds what the EDL
        // last set; without a saved value, static ones are set and Play
        // state is kept
        const saved = lastSet.get(component);
        const untouched =
          saved === undefined
            ? !isPlayState(world, component)
            : saved === stored;
        (untouched ? change.changed : kept).push(component);
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
    const lineage = record.getEntityLineage(eid);
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
        record.setEntityLineage(eid, def.extends);
      }
    }
  }

  if (dryRun) {
    return plan;
  }

  // What the EDL now sets is what later migrations compare play against
  for (const [i, { name }] of compiled.entities.entries()) {
    if (name && !missingNames.has(name)) {
      record.setEDLValues(ids[i]!, edlValues(world, components[i]!));
    }
  }

  for (const { eid, from, to } of plan.renamed) {
    record.deleteDefinitionName(from);
    record.setDefinitionName(to, eid);
  }

  // Atoms' Lineage and Script owners are rewritten from the EDL
  record.clearAtoms();
  for (const [name, atom] of edlAtoms) {
    record.setAtom(name, atom.extends, scriptPath(atom.own, path));
  }
  for (const [i, def] of compiled.entities.entries()) {
    if (def.name && existing.has(def.name)) {
      record.setEntityScript(ids[i]!, scriptPath(def.own, path));
    }
  }

  if (prune) {
    for (const { eid, name } of plan.gone) {
      prune(eid);
      record.deleteDefinitionName(name);
    }
    plan.pruned = plan.gone.length > 0;
  }

  record.setEDLHash(hashEDL(source));
  world.flush();
  return plan;
};

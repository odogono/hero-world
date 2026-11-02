import { addComponents } from '../component';
import type { Components } from '../types';
import { World } from '../world';
import { compileEDL, hashEDL, resolveEDL, scriptPath } from './compile';
import { readComponents, recordEDLValues } from './edl-values';
import { EDLExecutionError } from './errors';

type EntityRef = { id: number; world: World<Components> };

export type ExecuteOptions = {
  /** Path of the .edl file; `script.src` values resolve relative to it */
  path?: string;
};

export const executeEDL = <T extends Components>(
  world: World<T>,
  edl: string,
  options: ExecuteOptions = {}
): void => {
  const compiled = compileEDL(edl);
  const { atoms: rawAtoms, entities } = compiled;

  // Create entities without components to avoid schema validation before
  // resolving refs
  const entitiesById = new Map<number, EntityRef>();
  const entityIdsByName = new Map<string, number>();
  const ids = entities.map(def => {
    const entity = world.create();
    entitiesById.set(entity.id, entity as unknown as EntityRef);
    if (def.name) {
      entityIdsByName.set(def.name, entity.id);
    }
    return entity.id;
  });

  const resolved = resolveEDL(compiled, ids);
  const { errors } = resolved;
  for (const [i, eid] of ids.entries()) {
    const entity = entitiesById.get(eid)!;
    addComponents(
      entity as Parameters<typeof addComponents>[0],
      resolved.components[i]!
    );
  }

  if (errors.length > 0) {
    throw new EDLExecutionError(errors);
  }

  // Record Lineage: each atom's and entity's ordered base atoms
  for (const [name, atom] of rawAtoms.entries()) {
    world.setAtomLineage(name, atom.extends);
  }
  for (const [i, def] of entities.entries()) {
    world.setEntityLineage(ids[i]!, def.extends);
  }

  // Record Script owners: only atoms and entities that declare `script`
  // themselves own a Script; inheritors share their atom's Script
  for (const [name, atom] of rawAtoms.entries()) {
    const path = scriptPath(atom.own, options.path);
    if (path) {
      world.setScriptOwner('atom', name, path);
    }
  }
  for (const [i, def] of entities.entries()) {
    const path = scriptPath(def.own, options.path);
    if (path) {
      world.setScriptOwner('entity', ids[i]!, path);
    }
  }

  // Record Definition names, and the EDL they came from, for migrations
  for (const [name, eid] of entityIdsByName) {
    world.setDefinitionName(name, eid);
  }
  world.setEDLHash(hashEDL(edl));

  world.flush();

  // Record Play state as the EDL set it, so a migration can tell what
  // play has changed
  for (const eid of entityIdsByName.values()) {
    recordEDLValues(world, eid, readComponents(world, eid));
  }
};

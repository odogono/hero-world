import { toCamelCase } from 'odgn-helpers/string';

import { addComponents } from '../component';
import { createEntity } from '../entity';
import type { Components, World } from '../types';
import {
  EDLCircularReferenceError,
  EDLExecutionError,
  EDLMissingComponentError,
  EDLMissingPropertyError,
  EDLUnknownEntityReferenceError
} from './errors';
import { parseEDL } from './parser';

type ComponentData = Record<string, Record<string, unknown>>;

const mergeComponents = (
  base: ComponentData,
  extension?: ComponentData
): ComponentData => {
  if (!extension) {
    return { ...base };
  }
  const out: ComponentData = { ...base };
  for (const [name, data] of Object.entries(extension)) {
    out[name] = out[name]
      ? { ...(out[name] as Record<string, unknown>), ...data }
      : data;
  }
  return out;
};

export const executeEDL = <T extends Components>(
  world: World<T>,
  edl: string
): void => {
  const defs = parseEDL(edl);

  // Atoms are templates that can be extended by entities
  const atoms = new Map<string, ComponentData>();
  // Track created entities and their planned components prior to reference resolution
  const entityIdsByName = new Map<string, number>();
  const entityNameById = new Map<number, string | undefined>();
  const plannedComponentsById = new Map<number, ComponentData>();
  const entitiesById = new Map<
    number,
    { id: number; world: World<Components> }
  >();
  const entityPlansById = new Map<
    number,
    { extends: string[]; own: ComponentData }
  >();

  // First pass: collect atoms and create empty entities, record merged component plans
  for (const def of defs) {
    if (def.type === 'atom') {
      if (def.id) {
        atoms.set(def.id, def.components || {});
      }
      continue;
    }

    // Create entity without components to avoid schema validation before resolving refs
    const entity = createEntity(world as unknown as World<Components>);
    entitiesById.set(entity.id, entity as any);
    if (def.id) {
      entityIdsByName.set(def.id, entity.id);
    }
    entityNameById.set(entity.id, def.id);
    entityPlansById.set(entity.id, {
      extends: def.extends ?? [],
      own: def.components || {}
    });
  }

  // Collect errors during inheritance/reference resolution
  const errors: Array<
    | EDLUnknownEntityReferenceError
    | EDLMissingComponentError
    | EDLMissingPropertyError
    | EDLCircularReferenceError
  > = [];

  // Resolve inheritance for entities (supports atoms and entities, forward references allowed)
  const resolvedInheritance = new Map<number, ComponentData>();
  const resolveInheritance = (
    eid: number,
    stack: Set<number> = new Set()
  ): ComponentData => {
    if (resolvedInheritance.has(eid)) {
      return resolvedInheritance.get(eid)!;
    }
    if (stack.has(eid)) {
      // Circular inheritance; record error and return empty to avoid crash
      const name = entityNameById.get(eid) ?? String(eid);
      errors.push(new EDLCircularReferenceError(`extends:${name}`));
      return {};
    }
    stack.add(eid);
    const plan = entityPlansById.get(eid);
    if (!plan) {
      return {};
    }
    let inherited: ComponentData = {};
    for (const ext of plan.extends) {
      if (atoms.has(ext)) {
        inherited = mergeComponents(inherited, atoms.get(ext));
        continue;
      }
      const baseId = entityIdsByName.get(ext);
      if (baseId !== undefined) {
        const baseResolved = resolveInheritance(baseId, stack);
        inherited = mergeComponents(inherited, baseResolved);
      }
    }
    const combined = mergeComponents(inherited, plan.own);
    resolvedInheritance.set(eid, combined);
    return combined;
  };

  for (const eid of entityPlansById.keys()) {
    plannedComponentsById.set(eid, resolveInheritance(eid));
  }

  // Helper to resolve reference strings like $name or $name.comp.prop
  const resolveRef = (ref: string, seen: Set<string> = new Set()): unknown => {
    if (!ref.startsWith('$')) {
      return ref;
    }
    if (seen.has(ref)) {
      errors.push(new EDLCircularReferenceError(ref));
      return undefined;
    }
    seen.add(ref);
    const path = ref.slice(1).split('.');
    const [entityName, componentName, ...propPath] = path;
    const targetId = entityIdsByName.get(entityName);
    if (targetId === undefined) {
      errors.push(new EDLUnknownEntityReferenceError(entityName, { ref }));
      return undefined;
    }
    if (!componentName) {
      return targetId; // $name resolves to entity id
    }
    // Look up in planned components (pre-resolution) and then resolve recursively if needed
    const plan = plannedComponentsById.get(targetId);
    if (!plan) {
      errors.push(new EDLUnknownEntityReferenceError(entityName, { ref }));
      return undefined;
    }
    const compKey = toCamelCase(componentName);
    if (!(compKey in plan)) {
      errors.push(new EDLMissingComponentError(entityName, componentName));
      return undefined;
    }
    let value: any = plan[compKey];
    for (const key of propPath) {
      if (value == null) {
        break;
      }
      value = (value as any)[key];
      if (value === undefined) {
        errors.push(
          new EDLMissingPropertyError(
            entityName,
            `${componentName}.${propPath.join('.')}`
          )
        );
        return undefined;
      }
    }
    if (typeof value === 'string' && value.startsWith('$')) {
      return resolveRef(value, seen);
    }
    return value;
  };

  // Deeply resolve references within an object
  const resolveObject = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(resolveObject);
    }
    if (obj && typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = resolveObject(v);
      }
      return out;
    }
    if (typeof obj === 'string' && obj.startsWith('$')) {
      return resolveRef(obj);
    }
    return obj;
  };

  // Second pass: resolve references and add components to entities
  for (const [eid, plan] of plannedComponentsById.entries()) {
    const resolved = resolveObject(plan) as ComponentData;
    const entity = entitiesById.get(eid)!;
    addComponents(entity as any, resolved);
  }

  if (errors.length > 0) {
    throw new EDLExecutionError(errors);
  }

  // Persist all changes
  world.flush();
};

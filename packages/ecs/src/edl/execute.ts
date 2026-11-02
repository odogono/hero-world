import { toCamelCase } from 'odgn-helpers/string';

import { addComponents } from '../component';
import type { Components } from '../types';
import { World } from '../world';
import {
  compileEDL,
  hashEDL,
  resolveEDL,
  scriptPath,
  type ComponentData
} from './compile';
import {
  EDLCircularReferenceError,
  EDLExecutionError,
  EDLMissingPropertyError,
  EDLUnknownEntityReferenceError
} from './errors';

type EntityRef = { id: number; world: World<Components> };

export type ExecuteOptions = {
  commands?: Record<string, (...args: unknown[]) => void>;
  /** Path of the .edl file; `script.src` values resolve relative to it */
  path?: string;
};

export const executeEDL = <T extends Components>(
  world: World<T>,
  edl: string,
  options: ExecuteOptions = {}
): void => {
  const compiled = compileEDL(edl);
  const { atoms: rawAtoms, commands, entities } = compiled;

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
  const plannedComponentsById = new Map<number, ComponentData>();
  for (const [i, eid] of ids.entries()) {
    plannedComponentsById.set(eid, resolved.planned[i]!);
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

  // Persist initial entities/components so rows (ids) exist for command refs
  world.flush();

  // Command-time resolver that can fetch component row ids from DB
  const resolveRefForCommands = (
    ref: string,
    seen: Set<string> = new Set()
  ): unknown => {
    if (!ref.startsWith('$')) {
      return ref;
    }
    if (seen.has(ref)) {
      errors.push(new EDLCircularReferenceError(ref));
      return undefined;
    }
    seen.add(ref);
    const path = ref.slice(1).split('.');
    const [entityName = '', componentName = '', ...propPath] = path;
    const targetId = entityIdsByName.get(entityName);
    if (targetId === undefined) {
      errors.push(new EDLUnknownEntityReferenceError(entityName, { ref }));
      return undefined;
    }
    if (!componentName) {
      return targetId;
    }

    // Special entity meta props
    if (
      (componentName === 'id' || componentName === 'eid') &&
      propPath.length === 0
    ) {
      return targetId;
    }

    // Entity-level helper: $name._count -> number of components attached
    if (componentName === '_count' && propPath.length === 0) {
      let count = 0;
      for (const def of world.defs.values()) {
        try {
          const row = world.db
            .prepare(
              `SELECT 1 AS ok FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`
            )
            .get(targetId);
          if (row) {
            count++;
          }
        } catch {
          // ignore table issues
        }
      }
      return count;
    }

    const plan = plannedComponentsById.get(targetId);
    const compKey = componentName;
    let value: unknown = plan ? plan[compKey] : undefined;

    // Walk the path if available in planned components
    for (const key of propPath) {
      if (value == null) {
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }

    // If specifically asking for '.id' (or alias 'rowId' / '_row_id') and not present in plan, query DB for row id
    if (
      (value === undefined || value === null) &&
      propPath.length === 1 &&
      (propPath[0] === 'id' ||
        propPath[0] === 'rowId' ||
        propPath[0] === '_row_id')
    ) {
      const def = world.defs.get(compKey);
      if (def) {
        try {
          const row = world.db
            .prepare(`SELECT id FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`)
            .get(targetId) as { id?: unknown } | null | undefined;
          if (row && row.id !== undefined) {
            return row.id;
          }
        } catch {
          // ignore, fall through to error handling
        }
      }
    }

    // Ask for existence: returns boolean if a component row exists for eid
    if (
      (value === undefined || value === null) &&
      propPath.length === 1 &&
      (propPath[0] === 'exists' || propPath[0] === '_exists')
    ) {
      const def = world.defs.get(compKey);
      if (def) {
        try {
          const row = world.db
            .prepare(
              `SELECT 1 AS ok FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`
            )
            .get(targetId);
          return !!row;
        } catch {
          return false;
        }
      }
      return false;
    }

    if (typeof value === 'string' && value.startsWith('$')) {
      return resolveRefForCommands(value, seen);
    }

    if (value === undefined) {
      errors.push(
        new EDLMissingPropertyError(
          entityName,
          `${componentName}.${propPath.join('.')}`
        )
      );
    }
    return value;
  };

  // Execute commands in order
  const toValue = (raw: string): unknown => {
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    if (raw === 'null') {
      return null;
    }
    if (/^-?\d+$/.test(raw)) {
      return Number.parseInt(raw, 10);
    }
    if (/^-?\d+\.\d+$/.test(raw)) {
      return Number.parseFloat(raw);
    }
    if (raw.startsWith('$')) {
      return resolveRefForCommands(raw);
    }
    return raw;
  };

  for (const cmd of commands) {
    if (cmd.name === '!set') {
      // !set $entity.component.prop value
      const [target, rawValue] = cmd.rawArgs;
      if (target === undefined || rawValue === undefined) {
        continue;
      }
      const value = toValue(rawValue);
      if (!target.startsWith('$')) {
        continue;
      }
      const path = target.slice(1).split('.');
      const [entityName = '', componentName = '', ...propPath] = path;
      const eid = entityIdsByName.get(entityName ?? '');
      if (eid === undefined) {
        errors.push(
          new EDLUnknownEntityReferenceError(entityName ?? '', { ref: target })
        );
        continue;
      }
      const entity = entitiesById.get(eid)! as unknown as Record<
        string,
        Record<string, unknown> | undefined
      >;
      const compKey = componentName ?? '';
      // Prepare property key (only first-level used in tests)
      const propKey = propPath[0] ? toCamelCase(propPath[0]) : undefined;

      if (!propKey) {
        continue;
      }

      const component = entity[compKey];
      if (component) {
        // Component exists, set property directly
        component[propKey] = value;
      } else {
        const defaults: Record<string, unknown> = {};

        // Override with the provided property
        defaults[propKey] = value;
        // Add the component with defaults + property
        addComponents(
          entity as unknown as Parameters<typeof addComponents>[0],
          { [compKey]: defaults }
        );
      }
      continue;
    }

    // Arbitrary commands
    const handler = options.commands?.[cmd.name];
    if (typeof handler === 'function') {
      // Keep argument order exactly as specified in the EDL
      const args = cmd.rawArgs.map(toValue);
      handler(...args);
    }
  }

  if (errors.length > 0) {
    throw new EDLExecutionError(errors);
  }

  // Persist changes from commands
  world.flush();
};

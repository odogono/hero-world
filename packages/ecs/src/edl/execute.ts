import { toCamelCase } from 'odgn-helpers/string';

import { addComponents } from '@component';
import { parseEDL } from '@edl';
import { createEntity } from '@entity';
import type { Components, World } from '@types';

import {
  EDLCircularReferenceError,
  EDLExecutionError,
  EDLMissingComponentError,
  EDLMissingPropertyError,
  EDLUnknownEntityReferenceError
} from './errors';

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

export type ExecuteOptions = {
  commands?: Record<string, (...args: any[]) => void>;
};

// Lightweight command tokenizer supporting quoted strings and comments
const parseCommands = (edl: string) => {
  const lines = edl.split(/\r?\n/);
  const commands: Array<{ name: string; rawArgs: string[] }> = [];

  const stripComments = (line: string) => {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i - 1] !== '\\') {
        inQuotes = !inQuotes;
      }
      if (ch === '#' && !inQuotes) {
        return line.slice(0, i);
      }
    }
    return line;
  };

  const tokenize = (line: string): string[] => {
    const tokens: string[] = [];
    const re = /"([^"\\]|\\.)*"|\S+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line))) {
      const tok = match[0];
      if (tok.startsWith('"')) {
        // Unquote + unescape
        const inner = tok.slice(1, -1);
        tokens.push(
          inner.replaceAll(/\\(["\\nrt])/g, (_m, c) => {
            switch (c) {
              case 'n':
                return '\n';
              case 'r':
                return '\r';
              case 't':
                return '\t';
              case '"':
                return '"';
              case '\\':
              default:
                return '\\';
            }
          })
        );
      } else {
        tokens.push(tok);
      }
    }
    return tokens;
  };

  for (let raw of lines) {
    raw = stripComments(raw).trim();
    if (!raw || raw[0] !== '!') {
      continue;
    }
    const toks = tokenize(raw);
    if (toks.length === 0) {
      continue;
    }
    const name = toks[0];
    const rawArgs = toks.slice(1);
    commands.push({ name, rawArgs });
  }

  return commands;
};

export const executeEDL = <T extends Components>(
  world: World<T>,
  edl: string,
  options: ExecuteOptions = {}
): void => {
  const commands = parseCommands(edl);
  // Remove command lines before parsing entity/atom definitions
  const stripComments = (line: string) => {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i - 1] !== '\\') {
        inQuotes = !inQuotes;
      }
      if (ch === '#' && !inQuotes) {
        return line.slice(0, i);
      }
    }
    return line;
  };
  const edlForParse = edl
    .split(/\r?\n/)
    .map(l => stripComments(l))
    .filter(l => l.trim().length > 0 && l.trim()[0] !== '!')
    .join('\n');
  const defs = parseEDL(edlForParse);

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
    if (def.type !== 'entity') {
      // Ignore component definitions
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
    const compKey = componentName;
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
    const [entityName, componentName, ...propPath] = path;
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
      for (const def of (world as any).defs.values()) {
        try {
          const row = world.db
            .prepare(
              `SELECT 1 AS ok FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`
            )
            .get(targetId) as any;
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
    let value: any = plan ? (plan as any)[compKey] : undefined;

    // Walk the path if available in planned components
    for (const key of propPath) {
      if (value == null) {
        break;
      }
      value = (value as any)[key];
    }

    // If specifically asking for '.id' (or alias 'rowId' / '_row_id') and not present in plan, query DB for row id
    if (
      (value === undefined || value === null) &&
      propPath.length === 1 &&
      (propPath[0] === 'id' ||
        propPath[0] === 'rowId' ||
        propPath[0] === '_row_id')
    ) {
      const def = (world as any).defs.get(compKey);
      if (def) {
        try {
          const row = world.db
            .prepare(`SELECT id FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`)
            .get(targetId) as any;
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
      const def = (world as any).defs.get(compKey);
      if (def) {
        try {
          const row = world.db
            .prepare(
              `SELECT 1 AS ok FROM ${def.tableName} WHERE eid = ?1 LIMIT 1`
            )
            .get(targetId) as any;
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
  const toValue = (raw: string): any => {
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
      if (cmd.rawArgs.length < 2) {
        continue;
      }
      const target = cmd.rawArgs[0];
      const value = toValue(cmd.rawArgs[1]);
      if (!target.startsWith('$')) {
        continue;
      }
      const path = target.slice(1).split('.');
      const [entityName, componentName, ...propPath] = path;
      const eid = entityIdsByName.get(entityName ?? '');
      if (eid === undefined) {
        errors.push(
          new EDLUnknownEntityReferenceError(entityName ?? '', { ref: target })
        );
        continue;
      }
      const entity = entitiesById.get(eid)! as any;
      const compKey = componentName ?? '';
      // Prepare property key (only first-level used in tests)
      const propKey = propPath[0] ? toCamelCase(propPath[0]) : undefined;

      if (!propKey) {
        continue;
      }

      if (entity[compKey]) {
        // Component exists, set property directly
        entity[compKey][propKey] = value;
      } else {
        const defaults: Record<string, unknown> = {};

        // Override with the provided property
        defaults[propKey] = value;
        // Add the component with defaults + property
        addComponents(entity, { [compKey]: defaults } as any);
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

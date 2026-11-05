import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { parseEDL } from '.';
import {
  EDLCircularReferenceError,
  EDLInvalidExtendError,
  EDLMissingComponentError,
  EDLMissingPropertyError,
  EDLParseError,
  EDLUnknownEntityReferenceError
} from './errors';

export type ComponentData = Record<string, Record<string, unknown>>;

export type EDLResolutionError =
  | EDLUnknownEntityReferenceError
  | EDLMissingComponentError
  | EDLMissingPropertyError
  | EDLCircularReferenceError
  | EDLInvalidExtendError;

/** A definition as parsed: an atom, entity, component def or include */
export type EDLNode = {
  components?: ComponentData;
  extends?: string[];
  id?: string;
  /** The file an `include` names */
  path?: string;
  type: string;
  was?: string;
};

type EDLSyntaxError = {
  location?: { start?: { column?: unknown; line?: unknown } };
  message?: unknown;
};

/** An atom or entity as written: its bases and its own components */
export type Definition = { extends: string[]; own: ComponentData };

/** An entity definition, with its Definition name if it has one */
export type EntityDefinition = Definition & {
  name?: string;
  /** The Definition name it had before a rename (`entity b was a`) */
  was?: string;
};

/** An EDL source, parsed but not yet applied to a world */
export type CompiledEDL = {
  atoms: Map<string, Definition>;
  entities: EntityDefinition[];
};

/** The hash a world keeps of the EDL it was last built or migrated from */
export const hashEDL = (edl: string): string =>
  createHash('sha256').update(edl).digest('hex');

export const mergeComponents = (
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

/** The component that attaches a NorthTalk Script to an atom or entity */
const SCRIPT_COMPONENT = 'script';

export const scriptPath = (
  own: ComponentData,
  edlPath: string | undefined
): string | undefined => {
  const src = own[SCRIPT_COMPONENT]?.src;
  if (typeof src !== 'string' || src.length === 0) {
    return undefined;
  }
  return edlPath ? resolve(dirname(edlPath), src) : src;
};

export const stripComments = (line: string) => {
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

/** Parses an EDL source into its atoms and entities */
export const compileEDL = (edl: string): CompiledEDL =>
  compileNodes(parseNodes(edl));

/** Parses an EDL source into its definitions, includes left unread */
export const parseNodes = (edl: string): EDLNode[] => {
  const origLines = edl.split(/\r?\n/);
  const includeMap: Array<{ originalIndex: number; text: string }> = [];
  const parseLines: string[] = [];
  for (const [i, line] of origLines.entries()) {
    const stripped = stripComments(line);
    const trimmed = stripped.trim();
    if (trimmed.startsWith('!')) {
      // EDL commands were removed (ADR 0007)
      throw new EDLParseError(
        `EDL has no commands, at line ${i + 1}: ${trimmed}\nwrite the value inline on the entity or atom instead`,
        { line: i + 1 }
      );
    }
    if (trimmed.length > 0) {
      // Keep left whitespace intact in the parse buffer so columns align
      parseLines.push(stripped);
      includeMap.push({ originalIndex: i, text: line });
    }
  }
  const edlForParse = parseLines.join('\n');

  let defs: EDLNode[];
  try {
    defs = parseEDL(edlForParse);
  } catch (error_: unknown) {
    const error = error_ as EDLSyntaxError | undefined;
    // Try to produce a friendly error with original line/column and a code frame
    const loc = error?.location?.start;
    if (loc && typeof loc.line === 'number' && typeof loc.column === 'number') {
      const mapped = includeMap[loc.line - 1];
      const origIndex = mapped?.originalIndex ?? loc.line - 1; // fallback
      const displayLineNo = origIndex + 1;
      const lineText = (
        mapped?.text ??
        parseLines[loc.line - 1] ??
        ''
      ).toString();
      const caret = ' '.repeat(Math.max(0, loc.column - 1)) + '^';

      const prev = origLines[origIndex - 1];
      const next = origLines[origIndex + 1];

      const frameParts: string[] = [];
      if (prev !== undefined) {
        frameParts.push(`${displayLineNo - 1} | ${prev}`);
      }
      frameParts.push(`${displayLineNo} | ${lineText}`, `    | ${caret}`);
      if (next !== undefined) {
        frameParts.push(`${displayLineNo + 1} | ${next}`);
      }

      const friendly = [
        `EDL syntax error at line ${displayLineNo}, column ${loc.column}:`,
        String(error?.message ?? 'Syntax error'),
        '',
        ...frameParts
      ].join('\n');

      throw new EDLParseError(friendly, {
        column: loc.column,
        line: displayLineNo
      });
    }

    // Fallback if no location is available
    throw new EDLParseError(String(error?.message ?? 'EDL parse error'));
  }
  return defs;
};

/** The atoms and entities of parsed definitions; includes are ignored */
export const compileNodes = (defs: readonly EDLNode[]): CompiledEDL => {
  const atoms = new Map<string, Definition>();
  const entities: EntityDefinition[] = [];
  for (const def of defs) {
    if (def.type === 'atom') {
      if (def.id) {
        atoms.set(def.id, {
          extends: def.extends ?? [],
          own: def.components || {}
        });
      }
    } else if (def.type === 'entity') {
      entities.push({
        extends: def.extends ?? [],
        name: def.id,
        own: def.components || {},
        ...(def.was ? { was: def.was } : {})
      });
    }
    // component definitions are ignored here
  }

  return { atoms, entities };
};

/** What resolving a compiled EDL against entity ids gives */
export type ResolvedEDL = {
  /** Each entity's components, in the order of `compiled.entities` */
  components: ComponentData[];
  errors: EDLResolutionError[];
  /** Each entity's components before `$` references were resolved */
  planned: ComponentData[];
};

/**
 * Works out each entity's components: its atoms' components merged with its
 * own, with `$name` references resolved to the ids given in `ids`, which
 * holds one id per entity in `compiled.entities`.
 */
export const resolveEDL = (
  compiled: CompiledEDL,
  ids: readonly number[]
): ResolvedEDL => {
  const { atoms: rawAtoms, entities } = compiled;
  const errors: EDLResolutionError[] = [];

  const entityIdsByName = new Map<string, number>();
  for (const [i, entity] of entities.entries()) {
    if (entity.name) {
      entityIdsByName.set(entity.name, ids[i]!);
    }
  }

  // Resolve atom inheritance (atoms can extend other atoms)
  const resolvedAtoms = new Map<string, ComponentData>();
  const resolveAtom = (
    name: string,
    stack: Set<string> = new Set()
  ): ComponentData => {
    if (resolvedAtoms.has(name)) {
      return resolvedAtoms.get(name)!;
    }
    const atom = rawAtoms.get(name);
    if (!atom) {
      return {};
    }
    if (stack.has(name)) {
      errors.push(new EDLCircularReferenceError(`extends:${name}`));
      return {};
    }
    stack.add(name);
    let inherited: ComponentData = {};
    for (const base of atom.extends) {
      if (!rawAtoms.has(base) && entityIdsByName.has(base)) {
        errors.push(new EDLInvalidExtendError(name, base));
        continue;
      }
      if (!rawAtoms.has(base)) {
        continue; // unknown atom base ignored here
      }
      inherited = mergeComponents(inherited, resolveAtom(base, stack));
    }
    const combined = mergeComponents(inherited, atom.own);
    resolvedAtoms.set(name, combined);
    return combined;
  };
  for (const name of rawAtoms.keys()) {
    resolveAtom(name);
  }

  // Resolve inheritance for entities: only atoms may be extended
  const planned = entities.map(entity => {
    let inherited: ComponentData = {};
    for (const ext of entity.extends) {
      if (resolvedAtoms.has(ext)) {
        inherited = mergeComponents(inherited, resolvedAtoms.get(ext));
      } else if (entityIdsByName.has(ext)) {
        errors.push(new EDLInvalidExtendError(entity.name ?? '', ext));
      }
    }
    return mergeComponents(inherited, entity.own);
  });
  const plannedByName = new Map<string, ComponentData>();
  for (const [i, entity] of entities.entries()) {
    if (entity.name) {
      plannedByName.set(entity.name, planned[i]!);
    }
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
    const [entityName = '', componentName = '', ...propPath] = path;
    const targetId = entityIdsByName.get(entityName);
    if (targetId === undefined) {
      errors.push(new EDLUnknownEntityReferenceError(entityName, { ref }));
      return undefined;
    }
    if (!componentName) {
      return targetId; // $name resolves to entity id
    }
    const plan = plannedByName.get(entityName);
    if (!plan) {
      errors.push(new EDLUnknownEntityReferenceError(entityName, { ref }));
      return undefined;
    }
    if (!(componentName in plan)) {
      errors.push(new EDLMissingComponentError(entityName, componentName));
      return undefined;
    }
    let value: unknown = plan[componentName];
    for (const key of propPath) {
      if (value == null) {
        break;
      }
      value = (value as Record<string, unknown>)[key];
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
  const resolveObject = (obj: unknown): unknown => {
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

  const components = planned.map(plan => resolveObject(plan) as ComponentData);
  return { components, errors, planned };
};

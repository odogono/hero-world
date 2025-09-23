#!/usr/bin/env bun
/*
  Generate SQL, TypeScript types, and Zod schemas from an EDL file.

  - Uses parseEDL to parse atoms, entities, and component defs
  - Converts component defs to CDef and feeds cdefToSql/Types/Zod
  - Additionally emits SQL INSERTs for entities and their components

  Usage:
    bun run scripts/generate-from-edl.ts --input examples/zork.edl \
      [--sql-out schema.sql] [--types-out components.d.ts] [--zod-out schemas.ts] \
      [--include-entity] [--down] [--zod-no-imports]
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';

import { parseEDL } from '@edl';
import { cdefToSql } from '@schema/cdef-to-sql';
import { cdefToTypes } from '@schema/cdef-to-types';
import { cdefToZod } from '@schema/cdef-to-zod';
import type { CDef, CDefColumnInfo, CDefColumnType } from '@types';

import { defToTableName } from '../src';

type Flags = {
  down: boolean;
  includeEntity: boolean;
  input?: string;
  sqlOut?: string;
  typesOut?: string;
  zodNoImports: boolean;
  zodOut?: string;
};

type EDLParsed = Array<
  | {
      columns: Array<{
        default?: string;
        isUnique?: boolean;
        name: string;
        optional?: boolean;
        type: string;
      }>;
      id: string;
      tableName?: string;
      type: 'component';
    }
  | {
      components: Record<string, Record<string, unknown>>;
      id?: string;
      type: 'atom';
    }
  | {
      components: Record<string, Record<string, unknown>>;
      extends?: string[];
      id?: string;
      type: 'entity';
    }
>;

const parseArgs = (argv: string[]): Flags | 'help' | 'invalid' => {
  const flags: Flags = {
    down: false,
    includeEntity: false,
    zodNoImports: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      return 'help';
    }
    if (a === '--include-entity') {
      flags.includeEntity = true;
    } else if (a === '--down') {
      flags.down = true;
    } else if (a === '--zod-no-imports') {
      flags.zodNoImports = true;
    } else if (a === '--input') {
      flags.input = argv[++i];
    } else if (a === '--sql-out') {
      flags.sqlOut = argv[++i];
    } else if (a === '--types-out') {
      flags.typesOut = argv[++i];
    } else if (a === '--zod-out') {
      flags.zodOut = argv[++i];
    } else if (!flags.input && !a.startsWith('--')) {
      flags.input = a;
    } else {
      return 'invalid';
    }
  }
  return flags;
};

const showHelp = () => {
  console.log(
    `Usage: bun run scripts/generate-from-edl.ts --input file.edl [options]\n\nOptions:\n  --input <path>          EDL file path\n  --sql-out <path>        Write SQL (DDL + inserts) to file\n  --types-out <path>      Write TypeScript component types to file\n  --zod-out <path>        Write Zod schemas TS to file\n  --include-entity        Include tbl_entity in SQL up/down\n  --down                  Include DROP statements after CREATE\n  --zod-no-imports        Omit import line in Zod output (multi-embed)\n  -h, --help              Show this help\n`
  );
};

const toCDefType = (t: string): CDefColumnType => {
  const norm = t.toLowerCase();
  const allowed: CDefColumnType[] = [
    'string',
    'email',
    'enum',
    'int',
    'float',
    'boolean',
    'datetime',
    'date',
    'pk',
    'time',
    'timestamp',
    'json',
    'array'
  ];
  if ((allowed as string[]).includes(norm)) {
    return norm as CDefColumnType;
  }
  return 'string';
};

const mapComponentsToCDefs = (defs: EDLParsed): CDef[] => {
  const cdefs: CDef[] = [];
  for (const d of defs) {
    if (d.type !== 'component') {
      continue;
    }
    const columns: CDefColumnInfo[] = d.columns.map(col => ({
      isUnique: col.isUnique,
      name: col.name,
      optional: col.optional,
      type: toCDefType(col.type),
      // heuristic: coerce default string to number/boolean where obvious
      default:
        col.default === undefined
          ? undefined
          : col.default === 'true'
            ? (true as any)
            : col.default === 'false'
              ? (false as any)
              : isFinite(Number(col.default)) && col.default.trim() !== ''
                ? (Number(col.default) as any)
                : (col.default as any)
    }));
    cdefs.push({ columns, id: d.id, tableName: d.tableName });
  }
  return cdefs;
};

const sqlValue = (v: unknown): string => {
  if (v === null || v === undefined) {
    return 'NULL';
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : 'NULL';
  }
  if (typeof v === 'boolean') {
    return v ? '1' : '0';
  }
  const s = String(v);
  return `'${s.replaceAll("'", "''")}'`;
};

const buildInsertSQL = (edl: EDLParsed, cdefs: CDef[]): string => {
  const entities = edl.filter(d => d.type === 'entity') as Array<{
    components: Record<string, Record<string, unknown>>;
    extends?: string[];
    id?: string;
    type: 'entity';
  }>;
  const atoms = new Map<string, Record<string, Record<string, unknown>>>();
  for (const d of edl) {
    if (d.type === 'atom' && d.id) {
      atoms.set(d.id, d.components);
    }
  }
  const compById = new Map<string, CDef>();
  for (const c of cdefs) {
    compById.set(c.id, c);
  }

  // Assign stable numeric ids to entities in order of appearance
  const idMap = new Map<string, number>();
  let nextId = 1;
  for (const e of entities) {
    const key = e.id ?? `entity_${nextId}`;
    if (!idMap.has(key)) {
      idMap.set(key, nextId++);
    }
  }

  // Resolve extends components recursively
  const getEffectiveComponents = (
    e: {
      components: Record<string, Record<string, unknown>>;
      extends?: string[];
      id?: string;
    },
    seen: Set<string> = new Set()
  ): Record<string, Record<string, unknown>> => {
    const merged: Record<string, Record<string, unknown>> = {};
    const mergeInto = (src?: Record<string, Record<string, unknown>>) => {
      if (!src) {
        return;
      }
      for (const [k, v] of Object.entries(src)) {
        merged[k] = { ...(merged[k] || {}), ...v };
      }
    };
    if (e.extends && e.extends.length) {
      for (const ext of e.extends) {
        if (seen.has(ext)) {
          continue;
        } // avoid cycles
        seen.add(ext);
        if (atoms.has(ext)) {
          mergeInto(atoms.get(ext));
        } else {
          const target = entities.find(x => x.id === ext);
          if (target) {
            mergeInto(getEffectiveComponents(target, seen));
          }
        }
      }
    }
    mergeInto(e.components);
    return merged;
  };

  // Map component column names from schema to camelCase for matching
  const compColumnMap = new Map<
    string,
    Array<{ camel: string; snake: string }>
  >();
  for (const c of cdefs) {
    const cols = c.columns.map(col => ({
      camel: toCamelCase(col.name),
      snake: toSnakeCase(col.name) || col.name
    }));
    compColumnMap.set(c.id, cols);
  }

  const lines: string[] = [];
  if (entities.length) {
    lines.push('-- Seed entities');
    for (const e of entities) {
      const eid = idMap.get(e.id ?? '') ?? 0;
      if (!eid) {
        continue;
      }
      lines.push(`INSERT INTO tbl_entity (id) VALUES (${eid});`);

      const effective = getEffectiveComponents(e);
      for (const [compName, props] of Object.entries(effective)) {
        const schema = compById.get(compName);
        if (!schema) {
          continue;
        } // skip unknown components
        const cols = compColumnMap.get(compName) || [];
        const snakeCols: string[] = [];
        const values: string[] = [];
        // Always include eid first
        snakeCols.push('eid');
        values.push(String(eid));
        for (const [k, rawVal] of Object.entries(props)) {
          // map property key (already camelCased by parser) to schema column
          const match = cols.find(c => c.camel === k);
          if (!match) {
            continue;
          }
          // resolve references like $name to mapped entity ids
          let v: unknown = rawVal;
          if (typeof v === 'string' && v.startsWith('$')) {
            const ref = v.slice(1);
            const refId = idMap.get(ref);
            v = refId ?? null;
          }
          snakeCols.push(match.snake);
          values.push(sqlValue(v));
        }
        if (snakeCols.length > 1) {
          const tableName = defToTableName(schema);
          lines.push(
            `INSERT INTO ${tableName} (${snakeCols.join(', ')}) VALUES (${values.join(', ')});`
          );
        }
      }
    }
  }
  return lines.join('\n');
};

const main = () => {
  const parsed = parseArgs(process.argv);
  if (parsed === 'help') {
    return showHelp();
  }
  if (parsed === 'invalid' || !parsed.input) {
    console.error('Invalid arguments. Use --help.');
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), parsed.input);
  const edlRaw = readFileSync(inputPath, 'utf8');
  const edl = edlRaw.replaceAll('\uFEFF', ''); // strip BOMs if present anywhere
  const defs = parseEDL(edl) as EDLParsed;

  // Convert component defs to CDef
  const cdefs = mapComponentsToCDefs(defs);

  // Generate SQL DDL
  const up = true;
  const { sql } = cdefToSql(cdefs, {
    down: parsed.down,
    includeEntity: parsed.includeEntity,
    up
  });

  // Generate entity inserts
  const inserts = buildInsertSQL(defs, cdefs);
  const fullSql = inserts ? `${sql}\n\n${inserts}\n` : sql;

  // Generate types and zod
  const types = cdefToTypes(cdefs);
  const zod = cdefToZod(cdefs, { includeImports: !parsed.zodNoImports });

  // Output
  if (parsed.sqlOut) {
    writeFileSync(resolve(process.cwd(), parsed.sqlOut), fullSql, 'utf8');
  }
  if (parsed.typesOut) {
    writeFileSync(resolve(process.cwd(), parsed.typesOut), types, 'utf8');
  }
  if (parsed.zodOut) {
    writeFileSync(resolve(process.cwd(), parsed.zodOut), zod, 'utf8');
  }

  if (!parsed.sqlOut && !parsed.typesOut && !parsed.zodOut) {
    console.log('-- SQL --');
    console.log(fullSql);
    console.log('\n-- TYPES --');
    console.log(types);
    console.log('\n-- ZOD --');
    console.log(zod);
  }
};

main();

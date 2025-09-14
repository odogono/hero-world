#!/usr/bin/env bun
/*
  Generate SQL and Zod schema text from JSON CDef definitions.

  Usage:
    bun run scripts/generate-from-cdef.ts --input cdefs.json [--sql-out schema.sql] [--zod-out schemas.ts] [--include-entity] [--down] [--zod-no-imports]

  Input file format:
    - A single CDef object, an array of CDef, or nested arrays of CDef
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cdefToSql } from '../src/schema/cdef-to-sql';
import { cdefToZod } from '../src/schema/cdef-to-zod';

type Flags = {
  down: boolean;
  includeEntity: boolean;
  input?: string;
  sqlOut?: string;
  zodNoImports: boolean;
  zodOut?: string;
};

const parseArgs = (argv: string[]): Flags | 'help' | 'invalid' => {
  const flags: Flags = {
    down: false,
    includeEntity: false,
    zodNoImports: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return 'help';
    if (a === '--include-entity') flags.includeEntity = true;
    else if (a === '--down') flags.down = true;
    else if (a === '--zod-no-imports') flags.zodNoImports = true;
    else if (a === '--input') flags.input = argv[++i];
    else if (a === '--sql-out') flags.sqlOut = argv[++i];
    else if (a === '--zod-out') flags.zodOut = argv[++i];
    else if (!flags.input && !a.startsWith('--')) flags.input = a;
    else return 'invalid';
  }
  return flags;
};

const showHelp = () => {
  console.log(`Usage: bun run scripts/generate-from-cdef.ts --input cdefs.json [options]\n\nOptions:\n  --input <path>          JSON file with CDef(s)\n  --sql-out <path>        Write SQL output to file\n  --zod-out <path>        Write Zod schemas TS to file\n  --include-entity        Include tbl_entity in SQL up/down\n  --down                  Include DROP statements after CREATE\n  --zod-no-imports        Omit import line in Zod output (multi-embed)\n  -h, --help              Show this help\n`);
};

const main = () => {
  const parsed = parseArgs(process.argv);
  if (parsed === 'help') return showHelp();
  if (parsed === 'invalid' || !parsed.input) {
    console.error('Invalid arguments. Use --help.');
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), parsed.input);
  const raw = readFileSync(inputPath, 'utf8');
  let defs: unknown;
  try {
    defs = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON:', err);
    process.exit(1);
  }

  const up = true;
  const sqlResult = cdefToSql(defs as any, {
    includeEntity: parsed.includeEntity,
    up,
    down: parsed.down
  });
  const zodResult = cdefToZod(defs as any, {
    includeImports: !parsed.zodNoImports
  });

  if (parsed.sqlOut) {
    writeFileSync(resolve(process.cwd(), parsed.sqlOut), sqlResult.sql, 'utf8');
  }
  if (parsed.zodOut) {
    writeFileSync(resolve(process.cwd(), parsed.zodOut), zodResult, 'utf8');
  }

  if (!parsed.sqlOut && !parsed.zodOut) {
    console.log('-- SQL --');
    console.log(sqlResult.sql);
    console.log('\n-- ZOD --');
    console.log(zodResult);
  }
};

main();


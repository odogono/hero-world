#!/usr/bin/env bun
/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { toCamelCase, toPascalCase } from 'odgn-helpers/string';
import { z } from 'zod';

import { zodSchemaToSqliteTable } from '@schema/schema-to-sql';
import type { ComponentDefinition } from '@types';

/**
 * Dynamically import and discover all component definitions from a file
 */
const discoverComponents = async (
  filePath: string
): Promise<ComponentDefinition<any, any>[]> => {
  const absolutePath = resolve(filePath);
  console.log(`📂 Loading components from: ${absolutePath}`);

  try {
    const module = await import(absolutePath);
    const components: ComponentDefinition<any, any>[] = [];

    // Find all exported objects that look like component definitions
    for (const [exportName, exportValue] of Object.entries(module)) {
      if (isComponentDefinition(exportValue)) {
        console.log(`  ✓ Found component: ${exportName} (${exportValue.name})`);
        components.push(exportValue as ComponentDefinition<any, any>);
      }
    }

    if (components.length === 0) {
      console.warn('⚠️  No component definitions found in the specified file');
      console.log(
        '   Make sure your components are exported and created with defineComponent()'
      );
    }

    return components;
  } catch (error) {
    console.error(`❌ Failed to import file: ${filePath}`);
    console.error(error);
    process.exit(1);
  }
};

/**
 * Type guard to check if an object is a component definition
 */
const isComponentDefinition = (
  obj: unknown
): obj is ComponentDefinition<any, any> =>
  typeof obj === 'object' &&
  obj !== null &&
  'name' in obj &&
  'schema' in obj &&
  typeof (obj as any).name === 'string' &&
  typeof (obj as any).schema === 'object' &&
  (obj as any).schema?.shape !== undefined; // Check if it's a Zod object

/**
 * Generate TypeScript component type definitions
 */
const generateTypeScriptTypes = (
  components: ComponentDefinition<any, any>[],
  sourceFile: string
): string => {
  const lines: string[] = [];

  lines.push(
    '/* eslint-disable perfectionist/sort-objects */',
    '// Auto-generated TypeScript component types',
    `// Generated from component definitions in ${sourceFile}`,
    '',
    "import { z } from 'zod';",
    ''
  );

  // Generate individual component types
  for (const component of components) {
    const componentName = component.name;
    const pascalName = toPascalCase(componentName);
    const camelName = toCamelCase(componentName);

    lines.push(
      `// ${pascalName} Component`,
      `export type ${pascalName}Component = z.infer<typeof ${camelName}ComponentSchema>;`
    );
    lines.push(
      `export const ${camelName}ComponentSchema = ${generateZodSchemaString(component.schema)};`,
      ''
    );
  }

  // Generate a union type for all components
  const componentTypeNames = components.map(
    c => `${toPascalCase(c.name)}Component`
  );
  lines.push('// Union type for all components');
  lines.push(
    `export type AllComponents = ${componentTypeNames.join(' | ')};`,
    '',
    '// Components type for ECS World type inference',
    'export type Components = {'
  );
  for (const component of components) {
    const componentName = component.name;
    const camelName = toCamelCase(componentName);
    const pascalName = toPascalCase(componentName);
    lines.push(`  ${camelName}: ${pascalName}Component;`);
  }
  lines.push('}', '');

  return lines.join('\n');
};

/**
 * Generate a string representation of a Zod schema (excluding ECS base fields)
 */
const generateZodSchemaString = (schema: z.ZodObject<any>): string => {
  const shape = schema.shape;
  const fields: string[] = [];

  for (const [key, zodType] of Object.entries(shape)) {
    // Skip ECS base fields (id, eid) as they're added automatically
    if (key === 'id' && hasAutoIncrementMeta(zodType as z.ZodTypeAny)) {
      continue;
    }
    if (key === 'eid') {
      continue;
    }

    fields.push(`  ${key}: ${getZodTypeString(zodType as z.ZodTypeAny)}`);
  }

  return `z.object({\n${fields.join(',\n')}\n})`;
};

/**
 * Check if a Zod type has auto-increment metadata
 */
const hasAutoIncrementMeta = (zodType: z.ZodTypeAny): boolean => {
  const meta = zodType.meta();
  return meta?.autoIncrement === true;
};

/**
 * Convert Zod types to their string representation
 */
const getZodTypeString = (zodType: z.ZodTypeAny): string => {
  if (zodType instanceof z.ZodNumber) {
    return 'z.number()';
  }
  if (zodType instanceof z.ZodString) {
    return 'z.string()';
  }
  if (zodType instanceof z.ZodBoolean) {
    return 'z.boolean()';
  }
  if (zodType instanceof z.ZodEnum) {
    const values = zodType.options as readonly string[];
    const enumValues = values.map(v => `'${v}'`).join(', ');
    return `z.enum([${enumValues}])`;
  }
  if (zodType instanceof z.ZodDefault) {
    const innerType = getZodTypeString(zodType._def.innerType);
    const defaultValue = zodType._def.defaultValue;
    if (typeof defaultValue === 'string') {
      return `${innerType}.default('${defaultValue}')`;
    }
    return `${innerType}.default(${defaultValue})`;
  }

  // Fallback for unknown types
  return 'z.unknown()';
};

/**
 * Generate SQLite schema file
 */
const generateSQLiteSchema = (
  components: ComponentDefinition<any, any>[],
  sourceFile: string
): string => {
  const lines: string[] = [];

  lines.push(
    '-- Auto-generated SQLite schema',
    `-- Generated from component definitions in ${sourceFile}`,
    '',
    'PRAGMA foreign_keys = ON;',
    '',
    '-- Entity table (base table for all entities)',
    'CREATE TABLE IF NOT EXISTS tbl_entity (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT',
    ');',
    ''
  );

  // Generate component tables
  for (const component of components) {
    const result = zodSchemaToSqliteTable(component.schema);

    lines.push(
      `-- ${toPascalCase(component.name)} Component Table`,
      result.sql,
      ''
    );

    // Generate indexes if any
    if (result.indexes && result.indexes.length > 0) {
      lines.push(`-- Indexes for ${result.tableName}`);
      for (const index of result.indexes) {
        const uniqueClause = index.unique ? 'UNIQUE ' : '';
        const indexSql = `CREATE ${uniqueClause}INDEX IF NOT EXISTS ${index.name} ON ${index.tableName} (${index.columns.join(', ')});`;
        lines.push(indexSql);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
};

/**
 * Display usage information
 */
const showUsage = () => {
  console.log('Usage: bun run scripts/generate-schemas.ts [component-file]');
  console.log('');
  console.log('Arguments:');
  console.log(
    '  component-file    Path to TypeScript file containing component definitions'
  );
  console.log('                    (default: __test__/definitions.ts)');
  console.log('');
  console.log('Examples:');
  console.log('  bun run scripts/generate-schemas.ts');
  console.log('  bun run scripts/generate-schemas.ts src/game/components.ts');
  console.log(
    '  bun run scripts/generate-schemas.ts ../tank-world/src/components.ts'
  );
};

/**
 * Main function to generate both files
 */
const main = async () => {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showUsage();
    process.exit(0);
  }

  // Default to the test definitions file if no argument provided
  const sourceFile = args[0] || '__test__/definitions.ts';

  console.log('Generating TypeScript component types and SQLite schema...');
  console.log(`📂 Source file: ${sourceFile}\n`);

  try {
    // Discover components from the specified file
    const components = await discoverComponents(sourceFile);

    if (components.length === 0) {
      console.log('No components found. Exiting.');
      process.exit(1);
    }

    console.log(`\n🔧 Processing ${components.length} component(s)...\n`);

    // Generate TypeScript types
    const tsContent = generateTypeScriptTypes(components, sourceFile);
    const tsPath = resolve(__dirname, '../generated/component-types.ts');

    // Ensure generated directory exists
    mkdirSync(dirname(tsPath), { recursive: true });

    writeFileSync(tsPath, tsContent, 'utf8');
    console.log(`✅ Generated TypeScript types: ${tsPath}`);

    // Generate SQLite schema
    const sqlContent = generateSQLiteSchema(components, sourceFile);
    const sqlPath = resolve(__dirname, '../generated/schema.sql');
    writeFileSync(sqlPath, sqlContent, 'utf8');
    console.log(`✅ Generated SQLite schema: ${sqlPath}`);

    console.log('\n📊 Generated files:');
    console.log(`  📄 ${tsPath}`);
    console.log(`  🗃️  ${sqlPath}`);
    console.log('\n✨ Generation completed successfully!');
  } catch (error) {
    console.error('❌ Error generating schemas:', error);
    process.exit(1);
  }
};

// Run the script if called directly
if (import.meta.main) {
  await main();
}

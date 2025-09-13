import { toCamelCase } from 'odgn-helpers/string';

type EDLDefinition = {
  components: Record<string, Record<string, unknown>>;
  extends?: string[];
  id: string | undefined;
  type: 'atom' | 'entity';
};

type ParseState = {
  data?: unknown;
  name?: string;
  type: 'definition' | 'component' | 'property';
};

const parseSingleLineEDL = (edl: string): EDLDefinition[] => {
  const definitions: EDLDefinition[] = [];
  const stack: ParseState[] = [];
  let currentDefinition: EDLDefinition | null = null;
  let i = 0;

  while (i < edl.length) {
    // Skip whitespace
    while (i < edl.length && /\s/.test(edl[i]!)) {
      i++;
    }

    if (i >= edl.length) {
      break;
    }

    // Parse atom definition
    const atomMatch = edl.slice(i).match(/^atom\s+("([^"]*)"|(\w+))\s*{/);
    if (atomMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const atomId = atomMatch[2] || atomMatch[3]!; // Use quoted string or unquoted identifier
      currentDefinition = {
        components: {},
        id: atomId,
        type: 'atom'
      };
      stack.push({ name: atomId, type: 'definition' });
      i += atomMatch[0]!.length;
      continue;
    }

    // Parse entity definition - handle quoted names separately
    const quotedEntityWithInheritanceMatch = edl
      .slice(i)
      .match(/^entity\s+"([^"]*)"\s*:\s*"([^"]*)"\s*{\s*}/);
    const quotedEntityMatch = edl.slice(i).match(/^entity\s+"([^"]*)"\s*{\s*}/);
    const unquotedEntityWithInheritanceMatch = edl
      .slice(i)
      .match(/^entity\s+(\w+)\s*:\s*(\w+)\s*{\s*}/);
    const unquotedEntityMatch = edl.slice(i).match(/^entity\s+(\w+)\s*{\s*}/);
    const emptyEntityMatch = edl.slice(i).match(/^entity\s*{\s*}/);

    if (quotedEntityWithInheritanceMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const entityId = quotedEntityWithInheritanceMatch[1]!;
      const extendsId = quotedEntityWithInheritanceMatch[2]!;
      currentDefinition = {
        components: {},
        id: entityId,
        type: 'entity'
      };
      currentDefinition.extends = [extendsId];
      stack.push({ name: entityId, type: 'definition' });
      i += quotedEntityWithInheritanceMatch[0]!.length;
      continue;
    } else if (quotedEntityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const entityId = quotedEntityMatch[1]!;
      currentDefinition = {
        components: {},
        id: entityId,
        type: 'entity'
      };
      stack.push({ name: entityId, type: 'definition' });
      i += quotedEntityMatch[0]!.length;
      continue;
    } else if (unquotedEntityWithInheritanceMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const entityId = unquotedEntityWithInheritanceMatch[1]!;
      const extendsId = unquotedEntityWithInheritanceMatch[2]!;
      currentDefinition = {
        components: {},
        id: entityId,
        type: 'entity'
      };
      currentDefinition.extends = [extendsId];
      stack.push({ name: entityId, type: 'definition' });
      i += unquotedEntityWithInheritanceMatch[0]!.length;
      continue;
    } else if (unquotedEntityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const entityId = unquotedEntityMatch[1]!;
      currentDefinition = {
        components: {},
        id: entityId,
        type: 'entity'
      };
      stack.push({ name: entityId, type: 'definition' });
      i += unquotedEntityMatch[0]!.length;
      continue;
    } else if (emptyEntityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      currentDefinition = {
        components: {},
        id: undefined,
        type: 'entity'
      };
      stack.push({ name: undefined, type: 'definition' });
      i += emptyEntityMatch[0]!.length;
      continue;
    }

    // Handle opening brace
    if (edl[i] === '{') {
      i++;
      continue;
    }

    // Handle closing brace
    if (edl[i] === '}') {
      stack.pop();
      if (stack.length === 0 && currentDefinition) {
        definitions.push(currentDefinition);
        currentDefinition = null;
      }
      i++;
      continue;
    }

    // Parse component definition
    const componentMatch = edl.slice(i).match(/^(\w+)\s*{/);
    if (componentMatch && currentDefinition && stack.length === 1) {
      const componentName = componentMatch[1]!;
      currentDefinition.components[componentName] = {};
      stack.push({ name: componentName, type: 'component' });
      i += componentMatch[0]!.length;
      continue;
    }

    // Parse component property - for single-line, we need to be more careful about boundaries
    const propertyMatch = edl
      .slice(i)
      .match(/^(\w+):\s*([^}]+?)(?=\s+\w+:|$|})/);
    if (
      propertyMatch &&
      currentDefinition &&
      stack.length === 2 &&
      stack[1]?.type === 'component'
    ) {
      const [, key, value] = propertyMatch;
      const camelKey = toCamelCase(key!);
      const componentName = stack[1]!.name!;

      // Parse value
      let parsedValue: unknown = value!.trim();

      // Remove trailing comma if present
      if (typeof parsedValue === 'string' && parsedValue.endsWith(',')) {
        parsedValue = parsedValue.slice(0, -1).trim();
      }

      // Parse different value types
      if (parsedValue === 'true') {
        parsedValue = true;
      } else if (parsedValue === 'false') {
        parsedValue = false;
      } else if (parsedValue === 'null') {
        parsedValue = null;
      } else if (
        typeof parsedValue === 'string' &&
        /^-?\d+$/.test(parsedValue)
      ) {
        parsedValue = Number.parseInt(parsedValue, 10);
      } else if (
        typeof parsedValue === 'string' &&
        /^-?\d*\.\d+$/.test(parsedValue)
      ) {
        parsedValue = Number.parseFloat(parsedValue);
      } else if (
        typeof parsedValue === 'string' &&
        parsedValue.startsWith('"') &&
        parsedValue.endsWith('"')
      ) {
        parsedValue = parsedValue.slice(1, -1);
      }

      if (componentName && camelKey) {
        currentDefinition.components[componentName]![camelKey] = parsedValue;
      }
      i += propertyMatch[0]!.length;
      continue;
    }

    // If we get here, we couldn't parse the current position
    i++;
  }

  // Add the last definition if it exists
  if (currentDefinition) {
    definitions.push(currentDefinition);
  }

  return definitions;
};

export const parseEDL = (edl: string): EDLDefinition[] => {
  const lines = edl.split('\n');
  const definitions: EDLDefinition[] = [];
  const stack: ParseState[] = [];
  let currentDefinition: EDLDefinition | null = null;

  // Check if this is single-line EDL (no newlines and contains both { and })
  const isSingleLine =
    !edl.includes('\n') && edl.includes('{') && edl.includes('}');

  if (isSingleLine) {
    // Handle single-line EDL by parsing it as a single line
    const line = edl.trim();
    if (line && !line.startsWith('#')) {
      // Check if this line contains multiple definitions (contains both 'atom' and 'entity')
      if (line.includes('atom') && line.includes('entity')) {
        // Split by 'entity' to separate the definitions
        const parts = line.split(/(?=entity\s)/);
        const allDefinitions: EDLDefinition[] = [];
        for (const part of parts) {
          if (part.trim()) {
            const partDefinitions = parseSingleLineEDL(part.trim());
            allDefinitions.push(...partDefinitions);
          }
        }
        return allDefinitions;
      } else {
        return parseSingleLineEDL(line);
      }
    }
    return [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Parse atom definition
    const atomMatch = line.match(/^atom\s+("([^"]*)"|(\w+))\s*{/);
    if (atomMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }

      // Check if this is a single-line atom (contains both { and } on the same line)
      if (line.includes('}')) {
        // This is a single-line atom, parse it directly
        const singleLineResult = parseSingleLineEDL(line);
        if (singleLineResult.length > 0) {
          definitions.push(singleLineResult[0]!);
        }
        currentDefinition = null;
        continue;
      }

      const atomId = atomMatch[2] || atomMatch[3]!; // Use quoted string or unquoted identifier
      currentDefinition = {
        components: {},
        id: atomId,
        type: 'atom'
      };
      stack.push({ name: atomId, type: 'definition' });
      continue;
    }

    // Parse entity definition
    const entityMatch = line.match(
      /^entity\s+("([^"]*)"|(\w+))(?::\s*("([^"]*)"|(\w+)))?\s*{/
    );
    const emptyEntityMatch = line.match(/^entity\s*{/);
    const multiLineEntityMatch = line.match(/^entity\s+("([^"]*)"|(\w+)):\s*$/);

    if (entityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const entityId = entityMatch[2] || entityMatch[3]!; // Use quoted string or unquoted identifier
      const extendsId = entityMatch[5] || entityMatch[6]; // Use quoted string or unquoted identifier
      currentDefinition = {
        components: {},
        id: entityId,
        type: 'entity'
      };
      if (extendsId) {
        currentDefinition.extends = [extendsId];
      }
      stack.push({ name: entityId, type: 'definition' });
      continue;
    } else if (emptyEntityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      currentDefinition = {
        components: {},
        id: undefined,
        type: 'entity'
      };
      stack.push({ name: undefined, type: 'definition' });
      continue;
    } else if (multiLineEntityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      const entityId = multiLineEntityMatch[2] || multiLineEntityMatch[3]!; // Use quoted string or unquoted identifier
      currentDefinition = {
        components: {},
        extends: [],
        id: entityId,
        type: 'entity'
      };
      stack.push({ name: entityId, type: 'definition' });
      continue;
    }

    // Handle inheritance lines (when we have a multi-line entity definition)
    if (
      currentDefinition &&
      currentDefinition.type === 'entity' &&
      currentDefinition.extends &&
      stack.length === 1
    ) {
      const inheritanceMatch = line.match(/^\s*("([^"]*)"|(\w+))\s*$/);
      const inheritanceWithBraceMatch = line.match(
        /^\s*("([^"]*)"|(\w+))\s*{\s*}\s*$/
      );
      if (inheritanceMatch) {
        const inheritanceId = inheritanceMatch[2] || inheritanceMatch[3]!;
        currentDefinition.extends.push(inheritanceId);
        continue;
      } else if (inheritanceWithBraceMatch) {
        const inheritanceId =
          inheritanceWithBraceMatch[2] || inheritanceWithBraceMatch[3]!;
        currentDefinition.extends.push(inheritanceId);
        continue;
      }
    }

    // Handle opening brace
    if (line === '{') {
      continue;
    }

    // Handle closing brace
    if (line === '}') {
      stack.pop();
      if (stack.length === 0 && currentDefinition) {
        definitions.push(currentDefinition);
        currentDefinition = null;
      }
      continue;
    }

    // Parse component definition
    const componentMatch = line.match(/^(\w+)\s*{/);
    if (componentMatch && currentDefinition && stack.length === 1) {
      const componentName = componentMatch[1]!;
      currentDefinition.components[componentName] = {};
      stack.push({ name: componentName, type: 'component' });
      continue;
    }

    // Parse component property - handle both single-line and multi-line formats
    const propertyMatch = line.match(/^(\w+):\s*(.+)$/);
    if (
      propertyMatch &&
      currentDefinition &&
      stack.length === 2 &&
      stack[1]?.type === 'component'
    ) {
      const [, key, value] = propertyMatch;
      const camelKey = toCamelCase(key!)!;
      const componentName = stack[1]!.name!;

      // Parse value
      let parsedValue: unknown = value!.trim();

      // Remove trailing comma if present
      if (typeof parsedValue === 'string' && parsedValue.endsWith(',')) {
        parsedValue = parsedValue.slice(0, -1).trim();
      }

      // Parse different value types
      if (parsedValue === 'true') {
        parsedValue = true;
      } else if (parsedValue === 'false') {
        parsedValue = false;
      } else if (parsedValue === 'null') {
        parsedValue = null;
      } else if (
        typeof parsedValue === 'string' &&
        /^-?\d+$/.test(parsedValue)
      ) {
        parsedValue = Number.parseInt(parsedValue, 10);
      } else if (
        typeof parsedValue === 'string' &&
        /^-?\d*\.\d+$/.test(parsedValue)
      ) {
        parsedValue = Number.parseFloat(parsedValue);
      } else if (
        typeof parsedValue === 'string' &&
        parsedValue.startsWith('"') &&
        parsedValue.endsWith('"')
      ) {
        parsedValue = parsedValue.slice(1, -1);
      }

      if (componentName && camelKey) {
        currentDefinition.components[componentName]![camelKey] = parsedValue;
      }
    }
  }

  // Add the last definition if it exists
  if (currentDefinition) {
    definitions.push(currentDefinition);
  }

  return definitions;
};

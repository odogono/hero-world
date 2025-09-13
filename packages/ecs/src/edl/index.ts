type ParsedDefinition = {
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

const parseSingleLineEDL = (edl: string): ParsedDefinition[] => {
  const definitions: ParsedDefinition[] = [];
  const stack: ParseState[] = [];
  let currentDefinition: ParsedDefinition | null = null;
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
    const atomMatch = edl.slice(i).match(/^atom\s+(\w+)\s*{/);
    if (atomMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      currentDefinition = {
        components: {},
        id: atomMatch[1]!,
        type: 'atom'
      };
      stack.push({ name: atomMatch[1]!, type: 'definition' });
      i += atomMatch[0]!.length;
      continue;
    }

    // Parse entity definition
    const entityMatch = edl.slice(i).match(/^entity\s+(\w+)(?::\s*(\w+))?\s*{/);
    const emptyEntityMatch = edl.slice(i).match(/^entity\s*{/);
    if (entityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      currentDefinition = {
        components: {},
        id: entityMatch[1]!,
        type: 'entity'
      };
      if (entityMatch[2]) {
        currentDefinition.extends = [entityMatch[2]];
      }
      stack.push({ name: entityMatch[1]!, type: 'definition' });
      i += entityMatch[0]!.length;
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
      const camelKey = key!.replaceAll(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
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

      currentDefinition.components[componentName]![camelKey] = parsedValue;
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

export const parseEDL = (edl: string): ParsedDefinition[] => {
  const lines = edl.split('\n');
  const definitions: ParsedDefinition[] = [];
  const stack: ParseState[] = [];
  let currentDefinition: ParsedDefinition | null = null;

  // Check if this is single-line EDL (no newlines and contains both { and })
  const isSingleLine =
    !edl.includes('\n') && edl.includes('{') && edl.includes('}');

  if (isSingleLine) {
    // Handle single-line EDL by parsing it as a single line
    const line = edl.trim();
    if (line && !line.startsWith('#')) {
      return parseSingleLineEDL(line);
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
    const atomMatch = line.match(/^atom\s+(\w+)\s*{/);
    if (atomMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      currentDefinition = {
        components: {},
        id: atomMatch[1]!,
        type: 'atom'
      };
      stack.push({ name: atomMatch[1]!, type: 'definition' });
      continue;
    }

    // Parse entity definition
    const entityMatch = line.match(/^entity\s+(\w+)(?::\s*(\w+))?\s*{/);
    const emptyEntityMatch = line.match(/^entity\s*{/);
    if (entityMatch) {
      if (currentDefinition) {
        definitions.push(currentDefinition);
      }
      currentDefinition = {
        components: {},
        id: entityMatch[1]!,
        type: 'entity'
      };
      if (entityMatch[2]) {
        currentDefinition.extends = [entityMatch[2]];
      }
      stack.push({ name: entityMatch[1]!, type: 'definition' });
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
      const camelKey = key!.replaceAll(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
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

      currentDefinition.components[componentName]![camelKey] = parsedValue;
    }
  }

  // Add the last definition if it exists
  if (currentDefinition) {
    definitions.push(currentDefinition);
  }

  return definitions;
};

{
  // Types and helpers available to actions
  type EDLDefinition = {
    type: 'atom' | 'entity';
    id: string | undefined;
    extends?: string[];
    /** The Definition name the entity had before a rename */
    was?: string;
    components: Record<string, Record<string, unknown>>;
  };

  type EDLColumnType =
  | 'string'
  | 'email'
  | 'enum'
  | 'int'
  | 'float'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'pk'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'array';

  // Component definition types
  type EDLComponentColumn = {
    name: string;
    type: EDLColumnType;
    optional?: boolean;
    foreignKey?: string;
    isIndexed?: boolean;
    isUnique?: boolean;
    default?: string;
    values?: string[];
  };
  
  type EDLComponentDef = {
    type: 'component';
    id: string;
    tableName?: string;
    columns: EDLComponentColumn[];
  };

  const componentsFromEntries = (
    entries: Array<[string, Record<string, unknown>]>
  ): Record<string, Record<string, unknown>> => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of entries) out[k] = v;
    return out;
  };
}

Start
  = _ defs:(Definition _)* {
      return defs.map(d => d[0]);
    }

Definition
  = AtomDef
  / EntityDef
  / ComponentDef

AtomDef
  = 'atom' __ id:IdentifierOrString _ ':' _ exts:ExtendsList _ '{' _ comps:Components? _ '}' {
      return { type: 'atom', id, extends: exts, components: comps ?? {} } as EDLDefinition;
    }
  / 'atom' __ id2:IdentifierOrString _ '{' _ comps2:Components? _ '}' {
      return { type: 'atom', id: id2, components: comps2 ?? {} } as EDLDefinition;
    }

EntityDef
  = 'entity' __ id:IdentifierOrString was:WasName? _ ':' _ exts:ExtendsList _ '{' _ comps:Components? _ '}' {
      return { type: 'entity', id, was: was ?? undefined, extends: exts, components: comps ?? {} } as EDLDefinition;
    }
  / 'entity' __ id2:IdentifierOrString was2:WasName? _ '{' _ comps2:Components? _ '}' {
      return { type: 'entity', id: id2, was: was2 ?? undefined, components: comps2 ?? {} } as EDLDefinition;
    }
  / 'entity' _ '{' _ comps3:Components? _ '}' {
      return { type: 'entity', id: undefined, components: comps3 ?? {} } as EDLDefinition;
    }

// `entity garden_door was shed_door`: the name it had before a rename
WasName
  = __ 'was' __ old:IdentifierOrString { return old; }

// Component definition grammar
ComponentDef
  = 'def' __ id:Identifier _ '{' _ body:ComponentBody? _ '}' {
      const tableName = body?.tableName;
      const columns = body?.columns ?? [];
      return { type: 'component', id, tableName, columns } as EDLComponentDef;
    }

ComponentBody
  = lines:(ComponentLine _)* {
      const columns: EDLComponentColumn[] = [];
      let tableName: string | undefined;
      for (const [line] of lines) {
        if ((line as any).kind === 'table') tableName = (line as any).name;
        else if ((line as any).kind === 'column') columns.push((line as any).col);
      }
      return { tableName, columns };
    }

ComponentLine
  = ColumnLine

ColumnLine
  // Special-case JSON default to correctly capture braces without RestOfLine
  = name:Identifier _ ':' _ type:'json' _ 'default' _ j:(Object / Array) {
      const col: EDLComponentColumn = { name, type: 'json' };
      col.default = j;
      return { kind: 'column', col };
    }
  / name:Identifier _ ':' _ type:Identifier rest:RestOfLine {
      // Parse flags in the remainder of the line
      const restStr = rest?.trim?.() ?? '';
      // Strip inline comments while respecting quoted strings
      let tail = restStr;
      {
        let inQuotes = false;
        for (let i = 0; i < restStr.length; i++) {
          const ch = restStr[i];
          if (ch === '"' && restStr[i - 1] !== '\\') inQuotes = !inQuotes;
          if (ch === '#' && !inQuotes) { tail = restStr.slice(0, i).trim(); break; }
        }
      }
      const col: EDLComponentColumn = { name, type };
      if (tail.length) {
        const tokens = tail.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i];
          if (tok === 'not' && tokens[i + 1] === 'null') { col.optional = false; i++; continue; }
          if (tok === 'null') { continue; }
          if (tok === 'is_unique') { col.isUnique = true; continue; }
          if (tok === 'default') {
            const value = tokens.slice(i + 1).join(' ').trim();
            if (value.length > 0) {
              if (type === 'json') {
                try {
                  col.default = JSON.parse(value);
                } catch {
                  // If it is not valid JSON, preserve raw string
                  col.default = value;
                }
              } else {
                col.default = value;
              }
            }
            break;
          }
        }
      }
      return { kind: 'column', col };
    }

RestOfLine
  = s:$([^\n\r}]*) { return s; }

ExtendsList
  = head:IdentifierOrString tail:(_ IdentifierOrString)* {
      return [head, ...tail.map(t => t[1])];
    }

Components
  = list:(Component _)* {
      return componentsFromEntries(list.map(e => e[0]));
    }

Component
  = name:Identifier _ '{' _ props:Properties? _ '}' {
      return [name, props ?? {}] as [string, Record<string, unknown>];
    }

Properties
  = head:Property tail:(_ Property)* {
      const obj: Record<string, unknown> = {};
      const all = [head, ...tail.map(t => t[1])];
      for (const [k, v] of all) obj[k] = v;
      return obj;
    }

Property
  = key:Identifier _ ':' _ value:Value {
      return [toCamelCase(key), value] as [string, unknown];
    }

IdentifierOrString
  = s:String { return s; }
  / i:Identifier { return i; }

Identifier
  = $([A-Za-z_][A-Za-z0-9_]*)

String
  = '"' chars:DoubleChar* '"' { return chars.join(''); }
  / "'" chars2:SingleChar* "'" { return chars2.join(''); }

DoubleChar
  = '\\"' { return '"'; }
  / '\\n' { return '\n'; }
  / '\\r' { return '\r'; }
  / '\\t' { return '\t'; }
  / '\\\\' { return '\\'; }
  / $([^"\\])

SingleChar
  = "\\'" { return "'"; }
  / '\\n' { return '\n'; }
  / '\\r' { return '\r'; }
  / '\\t' { return '\t'; }
  / '\\\\' { return '\\'; }
  / $([^'\\])

Value
  = obj:Object { return obj; }
  / ref:Reference { return ref; }
  / arr:Array { return arr; }
  / s:String { return s; }
  / 'true' { return true; }
  / 'false' { return false; }
  / 'null' { return null; }
  / n:Float { return parseFloat(n); }
  / n:Int { return parseInt(n, 10); }

Int = $('-'? [0-9]+)
Float = $('-'? [0-9]+ '.' [0-9]+)

Reference
  = '$' head:Identifier tail:('.' (Identifier / Int))* {
      return (
        '$' +
        head +
        (tail.length ? tail.map(t => '.' + (typeof t[1] === 'string' ? t[1] : t[1])).join('') : '')
      );
    }

// Commas between elements are optional, as between component properties
Array
  = '[' _ first:Value tail:(_ ','? _ Value)* _ (',' _)? ']' {
      return [first, ...tail.map(t => t[3])];
    }
  / '[' _ ']' { return []; }

// JSON-like object literal for property values; commas between pairs are
// optional, as between component properties
Object
  = '{' _ head:Pair tail:(_ ','? _ Pair)* _ (',' _)? '}' {
      const out: Record<string, unknown> = {};
      out[head[0]] = head[1];
      for (const t of tail) {
        const [k, v] = t[3];
        out[k] = v;
      }
      return out;
    }
  / '{' _ '}' { return {}; }

Pair
  = key:(String / Identifier) _ ':' _ value:Value {
      return [key, value] as [string, unknown];
    }

_ "whitespace"
  = ( [ \t\r\n]+ / Comment )*

__ "space"
  = ( [ \t]+ / Comment )+

Comment
  = '#' [^\n]*

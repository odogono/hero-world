{
  // Types and helpers available to actions
  type EDLDefinition = {
    type: 'atom' | 'entity';
    id: string | undefined;
    extends?: string[];
    components: Record<string, Record<string, unknown>>;
  };

  const toCamelCase = (s: string): string =>
    s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

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

AtomDef
  = 'atom' __ id:IdentifierOrString _ '{' _ comps:Components? _ '}' {
      return { type: 'atom', id, components: comps ?? {} } as EDLDefinition;
    }

EntityDef
  = 'entity' __ id:IdentifierOrString _ ':' _ exts:ExtendsList _ '{' _ comps:Components? _ '}' {
      return { type: 'entity', id, extends: exts, components: comps ?? {} } as EDLDefinition;
    }
  / 'entity' __ id2:IdentifierOrString _ '{' _ comps2:Components? _ '}' {
      return { type: 'entity', id: id2, components: comps2 ?? {} } as EDLDefinition;
    }
  / 'entity' _ '{' _ '}' {
      return { type: 'entity', id: undefined, components: {} } as EDLDefinition;
    }

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
      return [toCamelCase(name), props ?? {}] as [string, Record<string, unknown>];
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
  = '"' chars:Character* '"' { return chars.join(''); }

Character
  = '\\"' { return '"'; }
  / '\\n' { return '\n'; }
  / '\\r' { return '\r'; }
  / '\\t' { return '\t'; }
  / '\\\\' { return '\\'; }
  / $([^"\\])

Value
  = ref:Reference { return ref; }
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

Array
  = '[' _ first:Value tail:(_ ',' _ Value)* _ ']' {
      return [first, ...tail.map(t => t[3])];
    }
  / '[' _ ']' { return []; }

_ "whitespace"
  = ( [ \t\r\n]+ / Comment )*

__ "space"
  = ( [ \t]+ / Comment )+

Comment
  = '#' [^\n]*

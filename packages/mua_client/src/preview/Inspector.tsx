import type { PreviewDefinition } from 'mua-local';

/**
 * The component inspector (#243): one card per component an entity has,
 * drawn from its Component Definition, with each field's name and value.
 * A Reference (an `eid` field) is a link to the entity it names. Read-only.
 */
export const Inspector = ({
  components,
  definitions,
  eid,
  labelOf,
  onOpen
}: {
  components: Record<string, Record<string, unknown>>;
  definitions: PreviewDefinition[];
  eid: number;
  labelOf: (eid: number) => string;
  onOpen: (eid: number) => void;
}) => {
  const names = Object.keys(components).sort();
  return (
    <section aria-label={`Entity ${labelOf(eid)}`} class="inspector">
      <h2>
        {labelOf(eid)} <span class="eid">#{eid}</span>
      </h2>
      {names.length === 0 && <p class="muted">It has no components.</p>}
      {names.map(name => {
        const data = components[name] ?? {};
        const columns = definitions.find(d => d.name === name)?.columns ?? [];
        return (
          <article aria-label={name} class="component-card" key={name}>
            <h3>{name}</h3>
            {columns.length === 0 ? (
              <p class="muted">No fields</p>
            ) : (
              <dl>
                {columns.map(col => (
                  <div key={col.name}>
                    <dt>{col.name}</dt>
                    <dd>
                      <Value
                        labelOf={labelOf}
                        onOpen={onOpen}
                        type={col.type}
                        value={data[col.name]}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        );
      })}
    </section>
  );
};

const Value = ({
  labelOf,
  onOpen,
  type,
  value
}: {
  labelOf: (eid: number) => string;
  onOpen: (eid: number) => void;
  type: string;
  value: unknown;
}) => {
  if (value === null || value === undefined) {
    return <span class="muted">—</span>;
  }
  if (type === 'eid' && typeof value === 'number') {
    return (
      <button class="ref" onClick={() => onOpen(value)} type="button">
        {labelOf(value)} <span class="eid">#{value}</span>
      </button>
    );
  }
  if (typeof value === 'object') {
    return <code>{JSON.stringify(value)}</code>;
  }
  return <code>{String(value)}</code>;
};

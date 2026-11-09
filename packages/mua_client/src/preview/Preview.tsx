import { useEffect, useMemo, useState } from 'preact/hooks';

import type {
  PreviewDefinition,
  PreviewEntity,
  PreviewResult
} from 'mua-local';

import { Inspector } from './Inspector';
import { openPreviewClient, type PreviewClient } from './client';

type Entry = PreviewResult & { text: string };

/**
 * The Admin Preview page (#243): the main World built from its EDL into a
 * private Preview World, where an author types commands, sees what each
 * Step changed and inspects any entity. Nothing here touches the live
 * World. `#165` grows it into the World editor.
 */
export const Preview = ({
  client: given,
  onClose
}: {
  /** In tests, a stand-in for the Worker */
  client?: PreviewClient;
  onClose: () => void;
}) => {
  const client = useMemo(() => given ?? openPreviewClient(), [given]);
  const [definitions, setDefinitions] = useState<PreviewDefinition[]>([]);
  const [entities, setEntities] = useState<PreviewEntity[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<number>();
  const [inspected, setInspected] =
    useState<Record<string, Record<string, unknown>>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');

  const labels = useMemo(
    () => new Map(entities.map(e => [e.eid, e.label])),
    [entities]
  );
  const labelOf = (eid: number) => labels.get(eid) ?? `#${eid}`;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run(async () => {
      const opened = await client.open();
      setDefinitions(opened.definitions);
      setEntities(opened.entities);
    });
    return () => client.close();
  }, [client]);

  // the inspected entity, read again after anything that may change it
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (selected === undefined) {
      setInspected(undefined);
      return;
    }
    let live = true;
    void client
      .entity(selected)
      .then(reply => live && setInspected(reply.components))
      .catch((error_: unknown) => live && setError(String(error_)));
    return () => {
      live = false;
    };
  }, [client, selected, seen]);

  const submit = (event: Event) => {
    event.preventDefault();
    const command = text.trim();
    if (command === '' || busy) {
      return;
    }
    setText('');
    void run(async () => {
      const result = await client.command(command);
      setEntities(result.entities);
      setEntries(all => [...all, { ...result, text: command }]);
      setSeen(n => n + 1);
    });
  };

  const reset = () =>
    run(async () => {
      const opened = await client.reset();
      setEntities(opened.entities);
      setEntries([]);
      setSeen(n => n + 1);
    });

  const shown = entities.filter(e =>
    `${e.label} ${e.eid}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <main class="preview">
      <header class="preview-head">
        <h1>Preview World</h1>
        <p class="muted">
          A private copy of the World, built from its EDL. Nothing here reaches
          the live World.
        </p>
        <div class="preview-actions">
          <button disabled={busy} onClick={() => void reset()} type="button">
            Reset
          </button>
          <button onClick={onClose} type="button">
            Back to play
          </button>
        </div>
      </header>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <section aria-label="Commands" class="preview-run">
        <ol aria-label="Preview transcript" class="preview-log">
          {entries.map((entry, i) => (
            <li key={i}>
              <div class="echo">&gt; {entry.text}</div>
              {entry.ok ? (
                entry.lines.map((line, j) => <div key={j}>{line}</div>)
              ) : (
                <div class="error">Refused: {entry.reason}</div>
              )}
              {entry.changes.length > 0 && (
                <ul aria-label="Changes" class="changes">
                  {entry.changes.map(([eid, name, kind], j) => (
                    <li key={j}>
                      <button
                        class="ref"
                        onClick={() => setSelected(eid)}
                        type="button"
                      >
                        {labelOf(eid)}
                      </button>{' '}
                      {name} <span class={`kind ${kind}`}>{kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <form onSubmit={submit}>
          <input
            aria-label="Preview command"
            disabled={busy}
            onInput={e => setText((e.target as HTMLInputElement).value)}
            placeholder={busy ? 'Building…' : 'take leaflet'}
            value={text}
          />
        </form>
      </section>
      <section aria-label="Entities" class="preview-entities">
        <input
          aria-label="Find an entity"
          onInput={e => setFilter((e.target as HTMLInputElement).value)}
          placeholder="Find an entity"
          value={filter}
        />
        <ul>
          {shown.map(e => (
            <li key={e.eid}>
              <button
                aria-current={e.eid === selected}
                class="ref"
                onClick={() => setSelected(e.eid)}
                type="button"
              >
                {e.label} <span class="eid">#{e.eid}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selected !== undefined && inspected && (
        <Inspector
          components={inspected}
          definitions={definitions}
          eid={selected}
          labelOf={labelOf}
          onOpen={setSelected}
        />
      )}
    </main>
  );
};

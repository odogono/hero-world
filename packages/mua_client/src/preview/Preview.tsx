import { useEffect, useMemo, useState } from 'preact/hooks';

import type {
  PreviewDefinition,
  PreviewEntity,
  PreviewMigration,
  PreviewResult
} from 'mua-local';

import { Inspector } from './Inspector';
import { openPreviewClient, type PreviewClient } from './client';

type Change = PreviewResult['changes'][number];
type Plan = Extract<PreviewMigration, { ok: true }>['plan'];

type Entry =
  | ({ kind: 'command'; text: string } & PreviewResult)
  | { kind: 'build' }
  | ({ kind: 'migration' } & PreviewMigration);

/**
 * The World editor (#165), grown from the Admin Preview page (#243): the
 * main World's EDL, edited as text, then Built into a private Preview World
 * or Migrated into the one already there, keeping its play state. An author
 * types commands, sees what each Step or Migration changed and inspects any
 * entity. What it produces is EDL to commit; nothing here touches the live
 * World.
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
  // the EDL being edited, and the EDL the Preview World holds now
  const [draft, setDraft] = useState('');
  const [current, setCurrent] = useState('');
  // the inspected entity is read again after anything that may change it
  const [seen, setSeen] = useState(0);

  const labels = useMemo(
    () => new Map(entities.map(e => [e.eid, e.label])),
    [entities]
  );
  const labelOf = (eid: number) => labels.get(eid) ?? `#${eid}`;
  const edited = draft !== current;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      setSeen(n => n + 1);
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
      setDraft(opened.edl ?? '');
      setCurrent(opened.edl ?? '');
    });
    return () => client.close();
  }, [client]);

  useEffect(() => {
    if (selected === undefined) {
      setInspected(undefined);
      return;
    }
    let live = true;
    void client
      .entity(selected)
      .then(reply => live && setInspected(reply.components))
      .catch(
        (error_: unknown) =>
          live &&
          setError(error_ instanceof Error ? error_.message : String(error_))
      );
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
      setEntries(all => [
        ...all,
        { ...result, kind: 'command', text: command }
      ]);
    });
  };

  // A fresh World from the draft, as a Build of an empty World
  const build = () =>
    run(async () => {
      const opened = await client.open({ edl: draft });
      setDefinitions(opened.definitions);
      setEntities(opened.entities);
      setCurrent(draft);
      setEntries([{ kind: 'build' }]);
    });

  // The World there now, migrated to the draft, keeping its play state
  const migrate = () =>
    run(async () => {
      const {
        definitions: defs,
        entities: next,
        ...migration
      } = await client.migrate(draft);
      setEntries(all => [...all, { ...migration, kind: 'migration' }]);
      if (migration.ok) {
        setDefinitions(defs);
        setEntities(next);
        setCurrent(draft);
      }
    });

  const reset = () =>
    run(async () => {
      const opened = await client.reset();
      setEntities(opened.entities);
      setCurrent(opened.edl ?? current);
      setEntries([]);
    });

  const shown = entities.filter(e =>
    `${e.label} ${e.eid}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <main class="preview editor">
      <header class="preview-head">
        <h1>World editor</h1>
        <p class="muted">
          Edit the World&apos;s EDL, then Build it fresh or Migrate the preview
          to it. Nothing here reaches the live World: what you keep is the EDL,
          to commit.
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
      <section aria-label="EDL" class="preview-edl">
        <div class="preview-actions">
          <button
            disabled={busy || draft === ''}
            onClick={() => void build()}
            title="A fresh World from this EDL"
            type="button"
          >
            Build
          </button>
          <button
            disabled={busy || !edited}
            onClick={() => void migrate()}
            title="Migrate the preview to this EDL, keeping its play state"
            type="button"
          >
            Migrate
          </button>
          <span class="muted">{edited ? 'Edited' : 'As built'}</span>
        </div>
        <textarea
          aria-label="EDL text"
          onInput={e => setDraft((e.target as HTMLTextAreaElement).value)}
          spellcheck={false}
          value={draft}
          wrap="off"
        />
      </section>
      <section aria-label="Commands" class="preview-run">
        <ol aria-label="Preview transcript" class="preview-log">
          {entries.map((entry, i) => (
            <li key={i}>
              {entry.kind === 'build' && (
                <div class="echo">Built a fresh World from the EDL.</div>
              )}
              {entry.kind === 'command' && (
                <>
                  <div class="echo">&gt; {entry.text}</div>
                  {entry.ok ? (
                    entry.lines.map((line, j) => <div key={j}>{line}</div>)
                  ) : (
                    <div class="error">Refused: {entry.reason}</div>
                  )}
                  <Changes
                    changes={entry.changes}
                    labelOf={labelOf}
                    onOpen={setSelected}
                  />
                </>
              )}
              {entry.kind === 'migration' &&
                (entry.ok ? (
                  <>
                    <div class="echo">Migrated to the edited EDL.</div>
                    <PlanSummary
                      labelOf={labelOf}
                      onOpen={setSelected}
                      plan={entry.plan}
                    />
                    <Changes
                      changes={entry.changes}
                      labelOf={labelOf}
                      onOpen={setSelected}
                    />
                  </>
                ) : (
                  <div class="error">
                    Not migrated: {entry.reason}. The preview is as it was.
                  </div>
                ))}
            </li>
          ))}
        </ol>
        <form onSubmit={submit}>
          <input
            aria-label="Preview command"
            disabled={busy}
            onInput={e => setText((e.target as HTMLInputElement).value)}
            placeholder={busy ? 'Building…' : 'take card'}
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

type Links = {
  labelOf: (eid: number) => string;
  onOpen: (eid: number) => void;
};

const Ref = ({ eid, labelOf, onOpen }: Links & { eid: number }) => (
  <button class="ref" onClick={() => onOpen(eid)} type="button">
    {labelOf(eid)}
  </button>
);

/** Each component a Step or Migration changed, linked to its entity */
const Changes = ({ changes, ...links }: Links & { changes: Change[] }) =>
  changes.length === 0 ? null : (
    <ul aria-label="Changes" class="changes">
      {changes.map(([eid, name, kind], j) => (
        <li key={j}>
          <Ref eid={eid} {...links} /> {name}{' '}
          <span class={`kind ${kind}`}>{kind}</span>
        </li>
      ))}
    </ul>
  );

const list = (items: string[]) => items.join(', ');

/** What a Migration did to the World, as its plan says (ADR 0005, 0008) */
const PlanSummary = ({ plan, ...links }: Links & { plan: Plan }) => {
  const rows: [string, preact.ComponentChildren][] = [];
  const { added, changed, removed } = plan.atoms;
  if (added.length > 0) {
    rows.push(['Atoms added', list(added)]);
  }
  if (changed.length > 0) {
    rows.push(['Atoms changed', list(changed)]);
  }
  if (removed.length > 0) {
    rows.push(['Atoms removed', list(removed)]);
  }
  if (plan.created.length > 0) {
    rows.push(['Created', list(plan.created)]);
  }
  for (const { eid, from, to } of plan.renamed) {
    rows.push([
      'Renamed',
      <>
        {from} → <Ref eid={eid} {...links} /> ({to})
      </>
    ]);
  }
  for (const u of plan.updated) {
    const parts = [
      ...u.added.map(c => `+${c}`),
      ...u.changed.map(c => `~${c}`),
      ...u.removed.map(c => `-${c}`)
    ];
    rows.push([
      'Updated',
      <>
        <Ref eid={u.eid} {...links} /> {parts.join(' ')}
      </>
    ]);
  }
  for (const k of plan.kept) {
    rows.push([
      'Kept play state',
      <>
        <Ref eid={k.eid} {...links} /> {list(k.components)}
      </>
    ]);
  }
  for (const g of plan.gone) {
    rows.push([
      'Gone from the EDL',
      <>
        <Ref eid={g.eid} {...links} /> (still in the World)
      </>
    ]);
  }
  if (plan.missing.length > 0) {
    rows.push([
      'Deleted in play, not brought back',
      list(plan.missing.map(m => m.name))
    ]);
  }
  return (
    <dl aria-label="Migration plan" class="plan">
      {rows.length === 0 ? (
        <div>
          <dt>No changes</dt>
          <dd />
        </div>
      ) : (
        rows.map(([term, detail], i) => (
          <div key={i}>
            <dt>{term}</dt>
            <dd>{detail}</dd>
          </div>
        ))
      )}
    </dl>
  );
};

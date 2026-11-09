import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'preact/hooks';

import type {
  MirrorSnapshot,
  PreviewDefinition,
  PreviewEntity,
  PreviewResult,
  TryItOrigin
} from 'mua-local';

import type { Placed } from '../connection';
import { openPreviewClient, type PreviewClient } from '../preview/client';
import type { Builder as Limits } from '../store';
import {
  REQUIRED,
  abilities,
  cardFor,
  fieldOrder,
  fresh,
  nameOf,
  problems,
  startFields,
  toSend,
  wordsOf,
  type Composition
} from './composition';

type Tab = 'compose' | 'try';

type Tried = { text: string } & PreviewResult;

/**
 * The composer (#260): a Builder makes a new thing from component cards,
 * tries it out in a private copy of where they stand (#259), and places it
 * in their room (#258). Nothing reaches the World until Place, and the
 * World checks it all again then.
 */
export const Builder = ({
  client: given,
  limits,
  onClose,
  place,
  snapshot
}: {
  /** In tests, a stand-in for the Preview World's Worker */
  client?: PreviewClient;
  limits: Limits;
  onClose: () => void;
  place: (composition: Record<string, unknown>) => Promise<Placed>;
  /** The mirror of what the Character perceives, as it is now */
  snapshot: () => Promise<MirrorSnapshot | undefined>;
}) => {
  const client = useMemo(() => given ?? openPreviewClient(), [given]);
  const [tab, setTab] = useState<Tab>('compose');
  const [composition, setComposition] = useState<Composition>(fresh);
  // the noun's words follow the name until the Builder edits them
  const [wordsEdited, setWordsEdited] = useState(false);
  const [definitions, setDefinitions] = useState<PreviewDefinition[]>([]);
  const [adding, setAdding] = useState(false);
  const [placing, setPlacing] = useState<'idle' | 'confirm' | 'sending'>(
    'idle'
  );
  const [notice, setNotice] = useState<string>();
  const [refusal, setRefusal] = useState<string>();
  const [error, setError] = useState<string>();

  const buildable = definitions.filter(d => d.buildable);
  const name = nameOf(composition).trim();
  const wrong = problems(composition, limits.max_capacity);
  const full = limits.placed >= limits.max_placed;

  // a Try it World of where the Character stands, for the definitions the
  // cards are drawn from, and to try the composition in
  const openTry = useCallback(
    async (from: Composition) => {
      const mirror = await snapshot();
      if (!mirror) {
        throw new Error("There's nowhere to try it yet: wait to be connected.");
      }
      return client.open({
        tryIt: { composition: toSend(from), mirror }
      });
    },
    [client, snapshot]
  );

  useEffect(() => {
    void openTry(fresh())
      .then(opened => setDefinitions(opened.definitions))
      .catch((error_: unknown) => setError(message(error_)));
    return () => client.close();
  }, [client, openTry]);

  const change = (next: Composition) => {
    setComposition(next);
    setNotice(undefined);
    setRefusal(undefined);
    if (placing === 'confirm') {
      setPlacing('idle');
    }
  };

  const setField = (component: string, field: string, value: unknown) => {
    const next = {
      ...composition,
      [component]: { ...composition[component], [field]: value }
    };
    if (component === 'noun' && field === 'words') {
      setWordsEdited(true);
    }
    if (
      component === REQUIRED &&
      field === 'name' &&
      next.noun &&
      !wordsEdited
    ) {
      next.noun = { ...next.noun, words: wordsOf(String(value)) };
    }
    change(next);
  };

  const add = (definition: PreviewDefinition) => {
    setAdding(false);
    change({
      ...composition,
      [definition.name]: startFields(definition, composition)
    });
  };

  const remove = (component: string) => {
    const { [component]: _gone, ...rest } = composition;
    if (component === 'noun') {
      setWordsEdited(false);
    }
    change(rest);
  };

  const confirmPlace = async () => {
    setPlacing('sending');
    const placed = await place(toSend(composition));
    setPlacing('idle');
    if (placed.ok) {
      setNotice(`Placed ${theName(name)} here.`);
      setComposition(fresh());
      setWordsEdited(false);
    } else {
      setRefusal(placed.reason);
    }
  };

  return (
    <aside aria-label="Builder" class="builder">
      <header class="builder-head">
        <span class="eyebrow">Build</span>
        <span class="quota">
          {limits.placed} of {limits.max_placed} placed
        </span>
        <button class="quiet" onClick={onClose} type="button">
          Back to play
        </button>
      </header>
      <h2>{name || 'Something new'}</h2>
      <div aria-label="Builder views" class="tabs" role="tablist">
        <button
          aria-selected={tab === 'compose'}
          onClick={() => setTab('compose')}
          role="tab"
          type="button"
        >
          Compose
        </button>
        <button
          aria-selected={tab === 'try'}
          onClick={() => setTab('try')}
          role="tab"
          type="button"
        >
          Try it
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {tab === 'compose' ? (
        <div class="compose" role="tabpanel">
          {Object.keys(composition).map(component => (
            <ComponentCard
              component={component}
              definition={definitions.find(d => d.name === component)}
              fields={composition[component] ?? {}}
              key={component}
              onChange={(field, value) => setField(component, field, value)}
              onRemove={
                component === REQUIRED ? undefined : () => remove(component)
              }
              problems={wrong
                .filter(p => p.component === component)
                .map(p => p.text)}
            />
          ))}
          <button
            aria-expanded={adding}
            class="add"
            disabled={buildable.every(d => d.name in composition)}
            onClick={() => setAdding(!adding)}
            type="button"
          >
            ＋ Add a component
          </button>
          {adding && (
            <ul aria-label="Components to add" class="palette">
              {buildable
                .filter(d => !(d.name in composition))
                .map(d => (
                  <li key={d.name}>
                    <button onClick={() => add(d)} type="button">
                      {cardFor(d.name).label} <code>{d.name}</code>
                      <span class="muted">{cardFor(d.name).does}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <section aria-label="What it can do" class="abilities">
            <span class="eyebrow">This combination enables</span>
            <ul>
              {abilities(composition).map(a => (
                <li class="chip" key={a}>
                  {a}
                </li>
              ))}
            </ul>
          </section>
          <PlaceBar
            components={Object.keys(composition)}
            full={full}
            name={name}
            onCancel={() => setPlacing('idle')}
            onConfirm={() => void confirmPlace()}
            onPlace={() => setPlacing('confirm')}
            placing={placing}
            ready={wrong.length === 0}
          />
          {notice && (
            <p class="notice" role="status">
              {notice}
            </p>
          )}
          {refusal && (
            <p class="error" role="alert">
              Not placed: {refusal}
            </p>
          )}
          <p class="muted small">
            Only you see this until you place it. Try it first, if you like.
          </p>
        </div>
      ) : (
        <TryIt
          composition={composition}
          open={openTry}
          reset={client.reset}
          send={client.command}
        />
      )}
    </aside>
  );
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const theName = (name: string) => `the ${name.toLowerCase()}`;

/** One component of the composition, as an editable card */
const ComponentCard = ({
  component,
  definition,
  fields,
  onChange,
  onRemove,
  problems: wrong
}: {
  component: string;
  definition: PreviewDefinition | undefined;
  fields: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  onRemove?: () => void;
  problems: string[];
}) => {
  const card = cardFor(component);
  const columns = definition?.columns ?? [];
  return (
    <section aria-label={card.label} class="build-card">
      <div class="build-card-head">
        <h3>{card.label}</h3>
        <code class="key">{component}</code>
        {onRemove && (
          <button
            aria-label={`Remove ${card.label}`}
            class="remove"
            onClick={onRemove}
            type="button"
          >
            ×
          </button>
        )}
      </div>
      {card.does && <p class="muted small">{card.does}</p>}
      {!definition && <p class="muted small">Getting its fields ready…</p>}
      <div class="build-fields">
        {fieldOrder(card, columns).map(col => (
          <Field
            field={col.name}
            key={col.name}
            label={card.fields[col.name] ?? col.name}
            long={card.long?.includes(col.name) ?? false}
            onChange={value => onChange(col.name, value)}
            type={col.type}
            value={fields[col.name]}
          />
        ))}
      </div>
      {wrong.map(text => (
        <p class="error small" key={text}>
          {text}
        </p>
      ))}
    </section>
  );
};

const Field = ({
  field,
  label,
  long,
  onChange,
  type,
  value
}: {
  field: string;
  label: string;
  long: boolean;
  onChange: (value: unknown) => void;
  type: string;
  value: unknown;
}) => {
  // the field's own name, where the label doesn't already say it
  const plain = label.toLowerCase() === field.replaceAll('_', ' ');
  const caption = (
    <span>
      {label}
      {!plain && (
        <>
          {' '}
          <code class="field-name">{field}</code>
        </>
      )}
    </span>
  );
  if (type === 'boolean') {
    return (
      <label class="field check">
        <input
          checked={value === true}
          onChange={e => onChange(e.currentTarget.checked)}
          type="checkbox"
        />
        {caption}
      </label>
    );
  }
  if (type === 'int' || type === 'float') {
    return (
      <label class="field">
        {caption}
        <input
          min={0}
          onInput={e => {
            const raw = e.currentTarget.value;
            onChange(raw === '' ? null : Number(raw));
          }}
          step={type === 'int' ? 1 : 'any'}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
        />
      </label>
    );
  }
  if (type === 'array') {
    return (
      <label class="field">
        {caption}
        <input
          onInput={e =>
            onChange(
              e.currentTarget.value
                .split(',')
                .map(w => w.trim())
                .filter(Boolean)
            )
          }
          placeholder="satchel, bag"
          type="text"
          value={Array.isArray(value) ? value.join(', ') : ''}
        />
      </label>
    );
  }
  const text = typeof value === 'string' ? value : '';
  return (
    <label class="field">
      {caption}
      {long ? (
        <textarea onInput={e => onChange(e.currentTarget.value)} value={text} />
      ) : (
        <input
          onInput={e => onChange(e.currentTarget.value)}
          type="text"
          value={text}
        />
      )}
    </label>
  );
};

/** Place, with a summary to confirm first, and the quota */
const PlaceBar = ({
  components,
  full,
  name,
  onCancel,
  onConfirm,
  onPlace,
  placing,
  ready
}: {
  components: string[];
  full: boolean;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  onPlace: () => void;
  placing: 'idle' | 'confirm' | 'sending';
  ready: boolean;
}) => {
  if (placing === 'idle') {
    return (
      <div class="place-bar">
        <button
          class="primary"
          disabled={!ready || full}
          onClick={onPlace}
          type="button"
        >
          Place here →
        </button>
        {full && (
          <span class="muted small">
            You have placed all the things you may.
          </span>
        )}
      </div>
    );
  }
  return (
    <div aria-label="Place it?" class="place-confirm" role="group">
      <p>
        Place {theName(name)} in the room you stand in? It is made of{' '}
        {components.map((c, i) => (
          <span key={c}>
            {i > 0 && ' + '}
            <code>{c}</code>
          </span>
        ))}
        . Anyone here can see and use it.
      </p>
      <div class="place-bar">
        <button
          class="primary"
          disabled={placing === 'sending'}
          onClick={onConfirm}
          type="button"
        >
          {placing === 'sending' ? 'Placing…' : 'Place it'}
        </button>
        <button
          class="quiet"
          disabled={placing === 'sending'}
          onClick={onCancel}
          type="button"
        >
          Not yet
        </button>
      </div>
    </div>
  );
};

/**
 * Try it (#259): the composition in a private copy of where the Character
 * stands. Commands run there, and each change says what it happened to:
 * the new thing, you, or something you can see.
 */
const TryIt = ({
  composition,
  open,
  reset,
  send
}: {
  composition: Composition;
  open: (from: Composition) => Promise<{
    entities: PreviewEntity[];
    origins?: [number, TryItOrigin][];
  }>;
  reset: PreviewClient['reset'];
  send: PreviewClient['command'];
}) => {
  const [tried, setTried] = useState<Tried[]>([]);
  const [entities, setEntities] = useState<PreviewEntity[]>([]);
  const [origins, setOrigins] = useState<Map<number, TryItOrigin>>(new Map());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [text, setText] = useState('');
  const name = nameOf(composition).trim();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  };

  const opened = (o: {
    entities: PreviewEntity[];
    origins?: [number, TryItOrigin][];
  }) => {
    setEntities(o.entities);
    setOrigins(new Map(o.origins ?? []));
    setTried([]);
  };

  // built afresh from the composition as it was when Try it opened
  const start = useRef(composition);
  useEffect(() => {
    let live = true;
    void open(start.current)
      .then(o => {
        if (live) {
          setEntities(o.entities);
          setOrigins(new Map(o.origins ?? []));
        }
      })
      .catch((error_: unknown) => live && setError(message(error_)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [open]);

  const labelOf = (eid: number) => {
    const origin = origins.get(eid);
    if (origin?.kind === 'composition') {
      return name ? `your ${name.toLowerCase()}` : 'your new thing';
    }
    if (origin?.kind === 'stand-in') {
      return 'you';
    }
    return entities.find(e => e.eid === eid)?.label ?? `#${eid}`;
  };

  const command = (line: string) => {
    const trimmed = line.trim();
    if (trimmed === '' || busy) {
      return;
    }
    setText('');
    void run(async () => {
      const result = await send(trimmed);
      setEntities(result.entities);
      setTried(all => [...all, { ...result, text: trimmed }]);
    });
  };

  const word = wordsOf(name).at(-1) ?? 'it';
  const suggestions = [
    `examine ${word}`,
    ...('item' in composition ? [`take ${word}`, `drop ${word}`] : []),
    ...('container' in composition ? [`open ${word}`, `close ${word}`] : []),
    ...('readable' in composition ? [`read ${word}`] : []),
    'look'
  ];

  return (
    <div class="try-it" role="tabpanel">
      <div class="try-head">
        <span class="muted small">
          A private copy of where you stand. Nothing here reaches the World.
        </span>
        <button
          disabled={busy}
          onClick={() => void run(async () => opened(await reset()))}
          type="button"
        >
          Reset
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <ol aria-label="Try it transcript" class="try-log">
        {tried.length === 0 && (
          <li class="muted">Try taking or opening it to see what changes.</li>
        )}
        {tried.map((t, i) => (
          <li key={i}>
            <div class="echo">&gt; {t.text}</div>
            {t.ok ? (
              t.lines.map((line, j) => <div key={j}>{line}</div>)
            ) : (
              <div class="error">Refused: {t.reason}</div>
            )}
            {(t.outside?.length ?? 0) > 0 && (
              <p class="warn small">
                That reached beyond what you can see (
                {t.outside!.map(o => o.label).join(', ')}). In the World it may
                go differently.
              </p>
            )}
            {shown(t.changes).length > 0 && (
              <ul aria-label="What changed" class="changes">
                {shown(t.changes).map(([eid, component, kind, data], j) => (
                  <li key={j}>
                    <strong>{labelOf(eid)}</strong> <code>{component}</code>{' '}
                    <span class={`kind ${kind}`}>{kind}</span>
                    {data && (
                      <span class="muted"> {summary(data, labelOf)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <nav aria-label="Things to try" class="actions">
        {suggestions.map(s => (
          <button
            class="chip"
            disabled={busy}
            key={s}
            onClick={() => command(s)}
            type="button"
          >
            {s}
          </button>
        ))}
      </nav>
      <form
        onSubmit={e => {
          e.preventDefault();
          command(text);
        }}
      >
        <input
          aria-label="Try a command"
          disabled={busy}
          onInput={e => setText(e.currentTarget.value)}
          placeholder={busy ? 'Getting it ready…' : 'What do you try?'}
          value={text}
        />
      </form>
    </div>
  );
};

/**
 * The changes worth showing a Builder: not a Character's own bookkeeping,
 * such as the command it last typed
 */
const shown = (changes: PreviewResult['changes']) =>
  changes.filter(([, component]) => component !== 'player');

/** A changed component's fields, with a Reference read as what it names */
const summary = (
  data: Record<string, unknown>,
  labelOf: (eid: number) => string
) =>
  Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(
      ([k, v]) =>
        `${k}: ${k === 'in' && typeof v === 'number' ? labelOf(v) : JSON.stringify(v)}`
    )
    .join(', ');

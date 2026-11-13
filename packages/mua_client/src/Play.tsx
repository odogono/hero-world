import { useEffect, useRef, useState } from 'preact/hooks';

import { Profile } from './Profile';
import { ComposerPanel } from './composer/ComposerPanel';
import {
  loadLocal,
  logout,
  mirrorSnapshot,
  place,
  putAway,
  saveEdit,
  saveLocal,
  sendCommand,
  stopEditing
} from './connection';
import {
  actions,
  builder,
  commands,
  editing,
  lines,
  status,
  type Status
} from './store';
import type { Line } from './transcript';

const STATUS_TEXT: Record<Status, string> = {
  connecting: 'Connecting…',
  joined: 'Connected',
  limbo: 'Left the world',
  offline: 'Offline',
  replaced: 'Playing elsewhere'
};

/**
 * A transcript line. Only the latest choice can be answered by clicking: a
 * choice answers by its number, so an older list's numbers would mean
 * nothing now. A line's Suggestions stay clickable: each is a Command, as
 * if typed, which the World answers as it is now (#275).
 */
const TranscriptLine = ({
  answerable,
  joined,
  line
}: {
  answerable: boolean;
  joined: boolean;
  line: Line;
}) => {
  switch (line.kind) {
    case 'command':
      return (
        <li class={`line command ${line.state}`}>
          <span class="caret">&gt;</span> {line.text}
          {line.state === 'unconfirmed' && (
            <span class="note"> (unconfirmed: it may not have happened)</span>
          )}
        </li>
      );
    case 'gap':
      return (
        <li class="line gap" role="separator">
          {line.reason === 'reload'
            ? 'reloaded: the lines above are from before, and you may have missed something'
            : 'connection lost: you may have missed something'}
        </li>
      );
    case 'prompt':
      return (
        <li class="line prompt">
          {line.text}
          <ol class="choices">
            {line.options.map((option, index) => (
              <li key={`${index}-${option}`}>
                {answerable ? (
                  <button
                    class="choice"
                    onClick={() => sendCommand(String(index + 1))}
                    type="button"
                  >
                    {option}
                  </button>
                ) : (
                  option
                )}
              </li>
            ))}
          </ol>
        </li>
      );
    case 'output':
      return (
        <li class="line output">
          {line.text}
          {line.suggestions && line.suggestions.length > 0 && (
            <span class="suggestions">
              {line.suggestions.map(suggestion => (
                <button
                  class="chip"
                  disabled={!joined}
                  key={suggestion}
                  onClick={() => sendCommand(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </span>
          )}
        </li>
      );
    default:
      return <li class={`line ${line.kind}`}>{line.text}</li>;
  }
};

/**
 * Fits a textarea's height to its text, up to the stylesheet's cap. Browsers
 * with `field-sizing: content` do this themselves.
 */
const fit = (el: HTMLTextAreaElement | null | undefined) => {
  if (el && !CSS.supports?.('field-sizing', 'content')) {
    el.style.height = 'auto';
    el.style.height = el.value ? `${el.scrollHeight}px` : '';
  }
};

/** Browsers that draw a block cursor themselves (Chromium, so far). */
const NATIVE_BLOCK =
  typeof CSS !== 'undefined' && CSS.supports?.('caret-shape', 'block');

/**
 * Where a drawn block cursor goes: the caret's offset while the box has
 * focus and nothing is selected, otherwise none.
 */
const caretOf = (el: HTMLTextAreaElement) =>
  document.activeElement === el && el.selectionStart === el.selectionEnd
    ? el.selectionStart
    : null;

/**
 * A block cursor for browsers without `caret-shape`. A textarea can't place
 * an element at its caret, so a mirror over it holds the same text,
 * invisible, and draws a block over the character after the caret. The
 * textarea's own caret is hidden.
 */
const BlockCaret = ({ at, text }: { at: number; text: string }) => (
  <div aria-hidden="true" class="caret-mirror">
    {text.slice(0, at)}
    <span class="block-caret">
      {text[at] && text[at] !== '\n' ? text[at] : ' '}
    </span>
  </div>
);

/**
 * The command box: a card that grows with what is typed. Enter sends, and
 * Shift+Enter starts a new line, for an admin's NorthTalk of more than one
 * statement.
 */
const CommandBox = ({ joined }: { joined: boolean }) => {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState<number | null>(null);
  /** how far back ↑ has gone through sent commands; null while typing anew */
  const [recalling, setRecalling] = useState<number | null>(null);
  /** what was being typed before ↑, brought back by ↓ */
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const show = (el: HTMLTextAreaElement, value: string) => {
    setText(value);
    el.value = value;
    el.setSelectionRange(value.length, value.length);
    fit(el);
  };

  /** ↑ and ↓ step through sent commands, from the first or last line only */
  const recall = (event: KeyboardEvent, step: -1 | 1) => {
    const el = event.currentTarget as HTMLTextAreaElement;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    if (step === -1 ? before.includes('\n') : after.includes('\n')) {
      return;
    }
    const sent = commands.value;
    const from = recalling ?? sent.length;
    const to = from + step;
    if (to < 0 || to > sent.length || (recalling === null && step === 1)) {
      return;
    }
    event.preventDefault();
    if (recalling === null) {
      setDraft(el.value);
    }
    setRecalling(to === sent.length ? null : to);
    show(el, to === sent.length ? draft : (sent[to] ?? ''));
  };

  // the caret moves with keys, clicks and selection, not only typing
  useEffect(() => {
    if (NATIVE_BLOCK) {
      return;
    }
    const track = () => {
      const el = box.current;
      setCaret(el ? caretOf(el) : null);
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, []);

  // the box is disabled until the Character joins, so autoFocus finds
  // nothing to focus on load: focus it on joining, and on rejoining
  useEffect(() => {
    if (joined) {
      box.current?.focus();
    }
  }, [joined]);

  const command = text.trim();

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (command && sendCommand(command)) {
      if (commands.value.at(-1) !== command) {
        commands.value = [...commands.value, command];
      }
      setRecalling(null);
      setText('');
      const form = (event?.currentTarget as HTMLElement | null)?.closest(
        'form'
      );
      const el = form?.querySelector('textarea');
      if (el) {
        el.value = '';
        fit(el);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      submit(event);
    } else if (event.key === 'ArrowUp') {
      recall(event, -1);
    } else if (event.key === 'ArrowDown') {
      recall(event, 1);
    }
  };

  return (
    <form
      class="command-box"
      onClick={() => box.current?.focus()}
      onSubmit={submit}
    >
      <div class={`command-box-input${NATIVE_BLOCK ? '' : ' drawn-caret'}`}>
        {!NATIVE_BLOCK && caret !== null && (
          <BlockCaret at={caret} text={text} />
        )}
        <textarea
          aria-label="Command"
          autoComplete="off"
          autoFocus
          disabled={!joined}
          onBlur={() => setCaret(null)}
          onInput={e => {
            setRecalling(null);
            setText(e.currentTarget.value);
            fit(e.currentTarget);
          }}
          onKeyDown={onKeyDown}
          onScroll={e => {
            const mirror = e.currentTarget.previousElementSibling;
            if (mirror) {
              mirror.scrollTop = e.currentTarget.scrollTop;
            }
          }}
          placeholder={joined ? 'What do you do?' : STATUS_TEXT[status.value]}
          ref={box}
          rows={1}
          spellcheck={false}
          value={text}
        />
      </div>
      <div class="command-box-bar">
        <span class="hint">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new
          line
        </span>
        <button
          aria-label="Send"
          class="send"
          disabled={!joined || !command}
          type="submit"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
    </form>
  );
};

export const Play = ({
  admin = false,
  email = null,
  name,
  offline = false,
  onLeft
}: {
  admin?: boolean;
  email?: string | null;
  name: string;
  /** Playing a Local World: the World can be saved and loaded */
  offline?: boolean;
  onLeft: () => void;
}) => {
  const end = useRef<HTMLLIElement>(null);
  const joined = status.value === 'joined';
  // the Composer (#260), for a Builder only: opened by Compose, or with a
  // placed thing the `edit` Verb opened (#275)
  const limits = builder.value;
  const opened = editing.value;
  const [building, setBuilding] = useState(false);
  const composing = (building || opened !== null) && limits !== null && joined;
  const count = lines.value.length;
  const lastPrompt = lines.value.findLast(line => line.kind === 'prompt')?.id;

  useEffect(() => {
    // reading back up stops the transcript following new lines, until the
    // reader scrolls down to the newest again
    if (end.current?.parentElement?.dataset.following !== 'no') {
      end.current?.scrollIntoView?.({ block: 'end' });
    }
  }, [count]);

  // closing an edit without saving closes the thing in the World too
  const close = () => {
    if (editing.value) {
      stopEditing();
    }
    setBuilding(false);
  };

  // an edit arrived over unsaved changes, which the Builder kept: the World
  // has opened the new thing, so a new draft closes it, and a placed
  // thing's draft opens that thing again
  const keep = (keeping: string | undefined) => {
    if (keeping === undefined) {
      stopEditing();
    } else {
      sendCommand(`edit the ${keeping.toLowerCase()}`);
    }
  };

  const leave = async () => {
    await logout();
    onLeft();
  };

  return (
    <div class={composing ? 'play composing' : 'play'}>
      <header>
        <strong class="brand">MUA</strong>
        <span class="version">v{MUA_VERSION}</span>
        {/* always present, so a change of status is announced; the
            profile menu and the badge's dot show it */}
        <span class="visually-hidden" role="status">
          {STATUS_TEXT[status.value]}
        </span>
        {count > 0 && (
          <button
            class="clear"
            onClick={() => {
              lines.value = [];
            }}
            type="button"
          >
            Clear
          </button>
        )}
      </header>
      <ul
        aria-label="Transcript"
        aria-live="polite"
        class="transcript"
        onScroll={e => {
          const el = e.currentTarget;
          el.dataset.following =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48
              ? 'yes'
              : 'no';
        }}
      >
        {lines.value.map(line => (
          <TranscriptLine
            answerable={joined && line.id === lastPrompt}
            joined={joined}
            key={line.id}
            line={line}
          />
        ))}
        <li aria-hidden="true" ref={end} />
      </ul>
      {actions.value.length > 0 && (
        <nav aria-label="Actions" class="actions">
          {actions.value.map(action => (
            <button
              class="chip"
              disabled={!joined}
              key={action}
              onClick={() => sendCommand(action)}
              type="button"
            >
              {action}
            </button>
          ))}
        </nav>
      )}
      <div class="dock">
        <Profile
          admin={admin}
          email={email}
          name={name}
          onLoad={offline ? file => void loadLocal(file) : undefined}
          onSave={offline ? saveLocal : undefined}
          onSignOut={leave}
          status={status.value}
          statusText={STATUS_TEXT[status.value]}
        />
        {limits && (
          <button
            aria-pressed={composing}
            class="compose-toggle"
            disabled={!joined}
            onClick={() => (composing ? close() : setBuilding(true))}
            type="button"
          >
            Compose
          </button>
        )}
        <CommandBox joined={joined} />
      </div>
      {composing && (
        <ComposerPanel
          editing={opened}
          limits={limits}
          onClose={close}
          onDecline={keep}
          onSaved={() => setBuilding(false)}
          place={place}
          putAway={putAway}
          save={saveEdit}
          snapshot={mirrorSnapshot}
        />
      )}
    </div>
  );
};

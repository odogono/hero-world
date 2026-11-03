import { useEffect, useRef, useState } from 'preact/hooks';

import { Profile } from './Profile';
import { logout, sendCommand } from './connection';
import { actions, lines, status, type Status } from './store';
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
 * nothing now.
 */
const TranscriptLine = ({
  answerable,
  line
}: {
  answerable: boolean;
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
          connection lost: you may have missed something
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
const Composer = ({ joined }: { joined: boolean }) => {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

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
    }
  };

  return (
    <form
      class="composer"
      onClick={() => box.current?.focus()}
      onSubmit={submit}
    >
      <div class={`composer-input${NATIVE_BLOCK ? '' : ' drawn-caret'}`}>
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
      <div class="composer-bar">
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
  onLeft
}: {
  admin?: boolean;
  email?: string | null;
  name: string;
  onLeft: () => void;
}) => {
  const end = useRef<HTMLLIElement>(null);
  const joined = status.value === 'joined';
  const count = lines.value.length;
  const lastPrompt = lines.value.findLast(line => line.kind === 'prompt')?.id;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  const leave = async () => {
    await logout();
    onLeft();
  };

  return (
    <div class="play">
      <header>
        <strong>{name}</strong>
        <span class={`status ${status.value}`} role="status">
          {STATUS_TEXT[status.value]}
        </span>
        <Profile admin={admin} email={email} name={name} onSignOut={leave} />
      </header>
      <ul aria-label="Transcript" aria-live="polite" class="transcript">
        {lines.value.map(line => (
          <TranscriptLine
            answerable={joined && line.id === lastPrompt}
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
      <Composer joined={joined} />
    </div>
  );
};

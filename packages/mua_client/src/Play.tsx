import { useEffect, useRef, useState } from 'preact/hooks';

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

/**
 * The command box: a card that grows with what is typed. Enter sends, and
 * Shift+Enter starts a new line, for an admin's NorthTalk of more than one
 * statement.
 */
const Composer = ({ joined }: { joined: boolean }) => {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

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
      <textarea
        aria-label="Command"
        autoComplete="off"
        autoFocus
        disabled={!joined}
        onInput={e => {
          setText(e.currentTarget.value);
          fit(e.currentTarget);
        }}
        onKeyDown={onKeyDown}
        placeholder={joined ? 'What do you do?' : STATUS_TEXT[status.value]}
        ref={box}
        rows={1}
        spellcheck={false}
        value={text}
      />
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
  name,
  onLeft
}: {
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
        <button class="link" onClick={leave} type="button">
          Log out
        </button>
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

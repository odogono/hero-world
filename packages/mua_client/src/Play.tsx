import { useEffect, useRef, useState } from 'preact/hooks';

import { logout, sendCommand } from './connection';
import { lines, status, type Status } from './store';
import type { Line } from './transcript';

const STATUS_TEXT: Record<Status, string> = {
  connecting: 'Connecting…',
  joined: 'Connected',
  limbo: 'Left the world',
  offline: 'Offline',
  replaced: 'Playing elsewhere'
};

const TranscriptLine = ({ line }: { line: Line }) => {
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
          <ol>
            {line.options.map(option => (
              <li key={option}>{option}</li>
            ))}
          </ol>
        </li>
      );
    default:
      return <li class={`line ${line.kind}`}>{line.text}</li>;
  }
};

export const Play = ({
  name,
  onLeft
}: {
  name: string;
  onLeft: () => void;
}) => {
  const [text, setText] = useState('');
  const end = useRef<HTMLLIElement>(null);
  const joined = status.value === 'joined';
  const count = lines.value.length;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  const submit = (event: Event) => {
    event.preventDefault();
    if (text.trim() && sendCommand(text.trim())) {
      setText('');
    }
  };

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
          <TranscriptLine key={line.id} line={line} />
        ))}
        <li aria-hidden="true" ref={end} />
      </ul>
      <form class="prompt-line" onSubmit={submit}>
        <span class="caret">&gt;</span>
        <input
          aria-label="Command"
          autoComplete="off"
          autoFocus
          disabled={!joined}
          onInput={e => setText(e.currentTarget.value)}
          placeholder={joined ? 'What do you do?' : STATUS_TEXT[status.value]}
          value={text}
        />
      </form>
    </div>
  );
};

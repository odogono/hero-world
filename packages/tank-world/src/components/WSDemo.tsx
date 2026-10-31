import { FormEvent, useCallback, useState } from 'react';

import { useWebSocket } from '@hooks/useWebSocket';

export const WSDemo = () => {
  const [name, setName] = useState('Guest');
  const [text, setText] = useState('');
  const { connect, disconnect, lastMessage, messages, sendJson, status } =
    useWebSocket();

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!text.trim()) {
        return;
      }
      sendJson({
        name: name.trim() || undefined,
        text: text.trim(),
        type: 'chat'
      });
      setText('');
    },
    [name, text, sendJson]
  );

  const sendHello = () =>
    sendJson({ name, text: 'hello from ui', type: 'chat' });

  return (
    <div className="w-full max-w-xl rounded border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">WebSocket Demo</h2>
        <span className="text-sm text-gray-600">status: {status}</span>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-50"
          disabled={status === 'open' || status === 'connecting'}
          onClick={connect}
        >
          Connect
        </button>
        <button
          className="rounded bg-gray-600 px-3 py-1 text-white disabled:opacity-50"
          disabled={status !== 'open' && status !== 'connecting'}
          onClick={disconnect}
        >
          Disconnect
        </button>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
          disabled={status !== 'open'}
          onClick={sendHello}
        >
          Send Hello
        </button>
      </div>

      <form className="mb-3 flex gap-2" onSubmit={onSubmit}>
        <input
          className="w-28 rounded border px-2 py-1"
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          value={name}
        />
        <input
          className="flex-1 rounded border px-2 py-1"
          onChange={e => setText(e.target.value)}
          placeholder="Message"
          value={text}
        />
        <button
          className="rounded bg-black px-3 py-1 text-white"
          disabled={status !== 'open'}
        >
          Send
        </button>
      </form>

      <div className="mb-2 text-sm text-gray-700">Last message:</div>
      <pre className="mb-3 max-h-36 overflow-auto rounded bg-gray-100 p-2 text-xs">
        {lastMessage
          ? typeof lastMessage.raw === 'string'
            ? lastMessage.raw
            : String(lastMessage.raw)
          : '—'}
      </pre>

      <div className="mb-2 text-sm text-gray-700">Recent (latest 10):</div>
      <div className="max-h-48 overflow-auto rounded border bg-gray-50 p-2 text-xs">
        {messages.slice(-10).map((m, i) => (
          <div className="mb-1" key={i}>
            <code>{m.raw}</code>
          </div>
        ))}
      </div>
    </div>
  );
};

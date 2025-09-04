import { FormEvent, useCallback, useMemo, useState } from 'react';
import { useWebSocket } from '@hooks/useWebSocket';

export function WSDemo() {
  const [name, setName] = useState('Guest');
  const [text, setText] = useState('');
  const { status, lastMessage, messages, sendJson, connect, disconnect } = useWebSocket();

  const parsed = useMemo(() => (lastMessage?.json as any) ?? null, [lastMessage]);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!text.trim()) return;
      sendJson({ type: 'chat', text: text.trim(), name: name.trim() || undefined });
      setText('');
    },
    [name, text, sendJson]
  );

  const sendHello = () => sendJson({ type: 'chat', text: 'hello from ui', name });

  return (
    <div className="w-full max-w-xl rounded border p-4 bg-white shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">WebSocket Demo</h2>
        <span className="text-sm text-gray-600">status: {status}</span>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-50"
          onClick={connect}
          disabled={status === 'open' || status === 'connecting'}
        >
          Connect
        </button>
        <button
          className="rounded bg-gray-600 px-3 py-1 text-white disabled:opacity-50"
          onClick={disconnect}
          disabled={status !== 'open' && status !== 'connecting'}
        >
          Disconnect
        </button>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
          onClick={sendHello}
          disabled={status !== 'open'}
        >
          Send Hello
        </button>
      </div>

      <form onSubmit={onSubmit} className="mb-3 flex gap-2">
        <input
          className="w-28 rounded border px-2 py-1"
          placeholder="Name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="flex-1 rounded border px-2 py-1"
          placeholder="Message"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button className="rounded bg-black px-3 py-1 text-white" disabled={status !== 'open'}>
          Send
        </button>
      </form>

      <div className="mb-2 text-sm text-gray-700">Last message:</div>
      <pre className="mb-3 max-h-36 overflow-auto rounded bg-gray-100 p-2 text-xs">
        {lastMessage ? (typeof lastMessage.raw === 'string' ? lastMessage.raw : String(lastMessage.raw)) : '—'}
      </pre>

      <div className="mb-2 text-sm text-gray-700">Recent (latest 10):</div>
      <div className="max-h-48 overflow-auto rounded border bg-gray-50 p-2 text-xs">
        {messages.slice(-10).map((m, i) => (
          <div key={i} className="mb-1">
            <code>{m.raw}</code>
          </div>
        ))}
      </div>
    </div>
  );
}


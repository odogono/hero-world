import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type WSStatus = 'connecting' | 'open' | 'closing' | 'closed';

export type UseWebSocketOptions = {
  url?: string;
  protocols?: string | string[];
  autoReconnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
};

export type WSMessage = {
  raw: string;
  json?: unknown;
  ts: number;
};

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = `${window.location.origin.replace(/^http/, 'ws')}/ws`,
    protocols,
    autoReconnect = true,
    reconnectAttempts = 5,
    reconnectDelayMs = 750
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnects = useRef(0);
  const reconnectTimer = useRef<number | null>(null);

  const [status, setStatus] = useState<WSStatus>('closed');
  const [error, setError] = useState<Event | null>(null);
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const lastMessage = useMemo(() => messages[messages.length - 1], [messages]);

  const cleanupTimer = () => {
    if (reconnectTimer.current) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  };

  const connect = useCallback(() => {
    cleanupTimer();
    setError(null);
    setStatus('connecting');

    const socket = new WebSocket(url, protocols);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnects.current = 0;
      setStatus('open');
    };

    socket.onmessage = evt => {
      const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
      let json: unknown | undefined;
      try {
        json = JSON.parse(raw);
      } catch {
        // non-JSON messages are fine
      }

      setMessages(prev => [...prev, { raw, json, ts: Date.now() }]);
    };

    socket.onerror = evt => {
      setError(evt);
    };

    socket.onclose = () => {
      setStatus('closed');
      if (autoReconnect && reconnects.current < reconnectAttempts) {
        const delay = reconnectDelayMs * Math.max(1, reconnects.current);
        reconnects.current += 1;
        reconnectTimer.current = window.setTimeout(() => connect(), delay);
      }
    };
  }, [autoReconnect, protocols, reconnectAttempts, reconnectDelayMs, url]);

  const disconnect = useCallback(() => {
    cleanupTimer();
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      setStatus('closing');
      ws.close();
    }
    wsRef.current = null;
  }, []);

  const send = useCallback((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(data);
    return true;
  }, []);

  const sendJson = useCallback((value: unknown) => {
    try {
      return send(JSON.stringify(value));
    } catch {
      return false;
    }
  }, [send]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
      cleanupTimer();
    };
    // We want to run this on mount/unmount only. Options are captured in connect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    error,
    messages,
    lastMessage,
    connect,
    disconnect,
    send,
    sendJson
  };
}


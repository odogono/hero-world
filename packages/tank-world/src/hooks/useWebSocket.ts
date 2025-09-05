import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createLog } from 'odgn-helpers/log';

const log = createLog('use-web-socket');

export type WSStatus = 'connecting' | 'open' | 'closing' | 'closed';

export type UseWebSocketOptions = {
  autoReconnect?: boolean;
  protocols?: string | string[];
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  url?: string | string[];
};

export type WSMessage = {
  json?: unknown;
  raw: string;
  ts: number;
};

export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const {
    autoReconnect = true,
    protocols,
    reconnectAttempts = 5,
    reconnectDelayMs = 750,
    url
  } = options;

  const defaultCandidates = useMemo(() => {
    const envUrl =
      ((import.meta as any).env?.VITE_WS_URL as string | undefined) ||
      undefined;
    const localWs = `${window.location.origin.replace(/^http/, 'ws')}/ws`;
    const direct = `ws://127.0.0.1:3001/ws`;
    const arr = [envUrl, localWs, direct].filter(Boolean) as string[];
    return arr;
  }, []);

  const candidates = useMemo(
    () => (Array.isArray(url) ? url : url ? [url] : defaultCandidates),
    [url, defaultCandidates]
  );

  const wsRef = useRef<WebSocket | null>(null);
  const reconnects = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const candidateIndex = useRef(0);
  const attemptedOnce = useRef(false);

  const [status, setStatus] = useState<WSStatus>('closed');
  const [error, setError] = useState<Event | null>(null);
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const lastMessage = useMemo(() => messages.at(-1), [messages]);

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

    const tryNext = () => {
      if (candidateIndex.current < candidates.length - 1) {
        candidateIndex.current += 1;
        attemptedOnce.current = false;
        connect();
        return true;
      }
      return false;
    };

    const target = candidates[candidateIndex.current];
    const socket = new WebSocket(target, protocols);
    wsRef.current = socket;

    let opened = false;
    socket.onopen = () => {
      opened = true;
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
      if (json.type === 'world:update') {
        return;
      }
      if (json.type === 'chat') {
        log.debug('chat', raw);
      }
      setMessages(prev => [...prev, { json, raw, ts: Date.now() }]);
    };

    socket.onerror = evt => {
      setError(evt);
    };

    socket.onclose = () => {
      // If we never opened, advance to next candidate once
      if (!opened && !attemptedOnce.current) {
        attemptedOnce.current = true;
        if (tryNext()) {
          return;
        }
      }
      setStatus('closed');
      // reset candidates on reconnect cycle
      candidateIndex.current = 0;
      attemptedOnce.current = false;
      if (autoReconnect && reconnects.current < reconnectAttempts) {
        const delay = reconnectDelayMs * Math.max(1, reconnects.current);
        reconnects.current += 1;
        reconnectTimer.current = window.setTimeout(() => connect(), delay);
      }
    };
  }, [
    autoReconnect,
    candidates,
    protocols,
    reconnectAttempts,
    reconnectDelayMs
  ]);

  const disconnect = useCallback(() => {
    cleanupTimer();
    const ws = wsRef.current;
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      setStatus('closing');
      ws.close();
    }
    wsRef.current = null;
  }, []);

  const send = useCallback(
    (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }
      ws.send(data);
      return true;
    },
    []
  );

  const sendJson = useCallback(
    (value: unknown) => {
      try {
        return send(JSON.stringify(value));
      } catch {
        return false;
      }
    },
    [send]
  );

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
    connect,
    disconnect,
    error,
    lastMessage,
    messages,
    send,
    sendJson,
    status
  };
};

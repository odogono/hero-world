import { useCallback, useEffect, useRef } from 'react';

import { createLog } from 'odgn-helpers/log';

const log = createLog('useWebSocket');

export type ServerMessage = {
  data?: string;
  /** What the player can see of a room, sent with `look` */
  room?: {
    description: string;
    exits: string[];
    items: string[];
    name: string;
    players: string[];
  };
  success?: boolean;
};

export const useWebSocket = (
  onMessageCallback?: (data: ServerMessage) => void,
  onStatusChange?: (status: 'connected' | 'disconnected' | 'connecting') => void
) => {
  const ws = useRef<WebSocket | null>(null);
  const onMessageCallbackRef = useRef(onMessageCallback);
  const onStatusChangeRef = useRef(onStatusChange);

  // Update callback refs when they change
  useEffect(() => {
    onMessageCallbackRef.current = onMessageCallback;
    onStatusChangeRef.current = onStatusChange;
  }, [onMessageCallback, onStatusChange]);

  const onOpen = useCallback(() => {
    log.info('WebSocket connected');
    onStatusChangeRef.current?.('connected');
  }, []);

  const onClose = useCallback(() => {
    log.info('WebSocket closed');
    onStatusChangeRef.current?.('disconnected');
  }, []);

  const onError = useCallback((event: Event) => {
    log.error('WebSocket error', event);
    onStatusChangeRef.current?.('disconnected');
  }, []);

  const onMessage = useCallback((event: MessageEvent) => {
    const parsed = JSON.parse(event.data);
    log.info('[onMessage]', event.type, parsed);

    // Call the callback if provided
    if (onMessageCallbackRef.current) {
      onMessageCallbackRef.current(parsed);
    }
  }, []);

  const connect = useCallback(
    (url: string) => {
      if (!ws.current) {
        ws.current = new WebSocket(url);
        ws.current.addEventListener('open', onOpen);
        ws.current.addEventListener('close', onClose);
        ws.current.addEventListener('message', onMessage);
        ws.current.addEventListener('error', onError);
      }
    },
    [onOpen, onClose, onMessage, onError]
  );

  const disconnect = useCallback(() => {
    if (ws.current) {
      ws.current.close();
      ws.current.removeEventListener('open', onOpen);
      ws.current.removeEventListener('close', onClose);
      ws.current.removeEventListener('message', onMessage);
      ws.current.removeEventListener('error', onError);
      ws.current = null;
    }
  }, [onOpen, onClose, onMessage, onError]);

  const send = useCallback((data: unknown) => {
    if (ws.current) {
      ws.current.send(JSON.stringify(data));
    }
  }, []);

  return {
    connect,
    disconnect,
    send
  };
};

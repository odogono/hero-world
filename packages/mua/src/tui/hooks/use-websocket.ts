import { useCallback, useEffect, useRef } from 'react';

import { createLog } from 'odgn-helpers/log';

const log = createLog('useWebSocket');

export const useWebSocket = () => {
  const ws = useRef<WebSocket | null>(null);

  const onOpen = useCallback(() => {
    log.info('WebSocket connected');
  }, []);

  const onClose = useCallback(() => {
    log.info('WebSocket closed');
  }, []);

  const onError = useCallback((event: Event) => {
    log.error('WebSocket error', event);
  }, []);

  const onMessage = useCallback((event: MessageEvent) => {
    log.info('[onMessage]', event.type, JSON.parse(event.data));
  }, []);

  const connect = useCallback((url: string) => {
    if (!ws.current) {
      ws.current = new WebSocket(url);
      ws.current.addEventListener('open', onOpen);
      ws.current.addEventListener('close', onClose);
      ws.current.addEventListener('message', onMessage);
      ws.current.addEventListener('error', onError);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (ws.current) {
      ws.current.close();
      ws.current.removeEventListener('open', onOpen);
      ws.current.removeEventListener('close', onClose);
      ws.current.removeEventListener('message', onMessage);
      ws.current.removeEventListener('error', onError);
      ws.current = null;
    }
  }, []);

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

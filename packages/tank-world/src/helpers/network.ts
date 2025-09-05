import type { ClientMessage } from '@/shared/messages';
import { useWebSocket } from '@hooks/useWebSocket';

export const useGameNetwork = () => {
  const ws = useWebSocket();

  const send = (msg: ClientMessage) => ws.sendJson(msg);

  const hello = (name?: string) => send({ type: 'hello', name });
  const spawn = (team: 'red' | 'blue', x: number, y: number) =>
    send({ type: 'cmd:spawn', team, x, y });
  const move = (id: number, x: number, y: number) => send({ type: 'cmd:move', id, x, y });

  return { ...ws, hello, spawn, move };
};


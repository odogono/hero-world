import type { ClientMessage } from '@/shared/messages';
import { useWebSocket } from '@hooks/useWebSocket';

export const useGameNetwork = () => {
  const ws = useWebSocket();

  const send = (msg: ClientMessage) => ws.sendJson(msg);

  const hello = (name?: string) => send({ name, type: 'hello' });
  const spawn = (team: 'red' | 'blue', x: number, y: number) =>
    send({ team, type: 'cmd:spawn', x, y });
  const move = (id: number, x: number, y: number) =>
    send({ id, type: 'cmd:move', x, y });

  return { ...ws, hello, move, spawn };
};

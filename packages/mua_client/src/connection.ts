import { Socket, type Channel } from 'phoenix';

import { actions, lines, status } from './store';
import {
  append,
  confirmed,
  connectionLost,
  rejoined,
  sent,
  unconfirmed
} from './transcript';

type Output = { lines: string[] };
type Prompt = { options: string[]; text: string };
type State = { actions?: string[] };
type Status = { status: 'connected' | 'limbo' | 'replaced' };

let socket: Socket | undefined;
let channel: Channel | undefined;

const add = (line: Parameters<typeof append>[1]) => {
  lines.value = append(lines.value, line);
};

const dropped = () => {
  if (status.value !== 'joined') {
    return;
  }
  status.value = 'offline';
  lines.value = connectionLost(lines.value);
};

/**
 * Plays one Character over its Channel (packages/mua_server/docs/protocol.md).
 * Phoenix rejoins by itself after a drop; this marks the gap when it does.
 */
export const connect = (token: string, character: number) => {
  socket = new Socket('/socket', { params: { token } });
  socket.onError(dropped);
  socket.onClose(dropped);
  socket.connect();

  let joinedBefore = false;
  channel = socket.channel(`character:${character}`);
  channel.on('output', ({ lines: told }: Output) => {
    for (const text of told) {
      add({ kind: 'output', text });
    }
  });
  channel.on('state', ({ actions: next }: State) => {
    actions.value = next ?? [];
  });
  channel.on('prompt', ({ options, text }: Prompt) =>
    add({ kind: 'prompt', options, text })
  );
  channel.on('status', ({ status: next }: Status) => {
    if (next === 'replaced') {
      status.value = 'replaced';
      add({ kind: 'status', text: 'You are playing in another window now.' });
    } else if (next === 'limbo') {
      status.value = 'limbo';
      add({ kind: 'status', text: 'You have left the world.' });
    }
  });
  channel.onError(dropped);
  channel
    .join()
    .receive('ok', () => {
      if (joinedBefore) {
        lines.value = rejoined(lines.value);
      }
      joinedBefore = true;
      status.value = 'joined';
    })
    .receive('error', ({ reason }: { reason: string }) =>
      add({ kind: 'error', text: `Couldn't join: ${reason}` })
    );
};

/**
 * Sends a command, only while joined: Phoenix would otherwise buffer it and
 * send it on rejoining, turning an offline command into a later action.
 */
export const sendCommand = (text: string) => {
  if (!channel || status.value !== 'joined' || !socket?.isConnected()) {
    return false;
  }
  const [next, ref] = sent(lines.value, text);
  lines.value = next;
  channel
    .push('command', { ref, text })
    .receive('ok', () => {
      lines.value = confirmed(lines.value, ref);
    })
    .receive('error', ({ reason }: { reason: string }) => {
      lines.value = unconfirmed(lines.value, ref);
      add({ kind: 'error', text: `Not sent: ${reason}` });
    })
    .receive('timeout', () => {
      lines.value = unconfirmed(lines.value, ref);
    });
  return true;
};

/** Leaves the World: the Character goes to Limbo at once */
export const logout = () =>
  new Promise<void>(resolve => {
    if (!channel || status.value !== 'joined') {
      resolve();
      return;
    }
    channel
      .push('logout', {})
      .receive('ok', () => resolve())
      .receive('error', () => resolve())
      .receive('timeout', () => resolve());
  }).then(() => {
    socket?.disconnect();
    socket = undefined;
    channel = undefined;
  });

/** The socket, for the browser checks to cut its Connection */
export const currentSocket = () => socket;

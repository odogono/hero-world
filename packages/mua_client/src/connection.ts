import type { FromWorld } from 'mua-local';
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
/** A Local World's Worker, while playing offline (ADR 0023) */
let worker: Worker | undefined;

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
 * Plays a Local World offline: the main World in a Web Worker, which speaks
 * the Channel's messages (packages/mua-local). Its Character is made with
 * `name` the first time, and played again after a reload.
 */
export const connectLocal = (name: string) => {
  worker?.terminate();
  worker = new Worker('/local/worker.js', { type: 'module' });
  worker.addEventListener('message', ({ data }: MessageEvent<FromWorld>) => {
    switch (data.event) {
      case 'output':
        for (const text of data.lines) {
          add({ kind: 'output', text });
        }
        break;
      case 'state':
        actions.value = data.state.actions;
        break;
      case 'prompt':
        add({ kind: 'prompt', options: data.options, text: data.text });
        break;
      case 'status':
        if (data.status === 'connected') {
          status.value = 'joined';
        } else {
          status.value = 'limbo';
          add({ kind: 'status', text: 'You have left the world.' });
        }
        break;
      case 'reply':
        if (data.ref !== undefined) {
          lines.value = data.ok
            ? confirmed(lines.value, Number(data.ref))
            : unconfirmed(lines.value, Number(data.ref));
        }
        if (!data.ok) {
          add({ kind: 'error', text: `Not sent: ${data.reason}` });
        }
        break;
      case 'error':
        add({ kind: 'error', text: `The world stopped: ${data.message}` });
        status.value = 'offline';
        break;
      default:
        break;
    }
  });
  worker.addEventListener('error', event => {
    add({ kind: 'error', text: `The world stopped: ${event.message}` });
    status.value = 'offline';
  });
  worker.postMessage({ name, type: 'join' });
};

/**
 * Sends a command, only while joined: Phoenix would otherwise buffer it and
 * send it on rejoining, turning an offline command into a later action.
 */
export const sendCommand = (text: string) => {
  if (worker) {
    if (status.value !== 'joined') {
      return false;
    }
    const [next, ref] = sent(lines.value, text);
    lines.value = next;
    worker.postMessage({ ref, text, type: 'command' });
    return true;
  }
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
export const logout = () => (worker ? logoutLocal() : logoutRemote());

// The Local World puts its Character in Limbo, then the Worker stops, and
// World time with it
const logoutLocal = () =>
  new Promise<void>(resolve => {
    const local = worker!;
    local.addEventListener('message', ({ data }: MessageEvent<FromWorld>) => {
      if (data.event === 'status' && data.status === 'limbo') {
        resolve();
      }
    });
    local.postMessage({ type: 'logout' });
  }).then(() => {
    worker?.terminate();
    worker = undefined;
  });

const logoutRemote = () =>
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

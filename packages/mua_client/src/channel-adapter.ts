/**
 * A server's World over its Phoenix Channel
 * (packages/mua_server/docs/protocol.md): the Connection's adapter for
 * playing online. Phoenix rejoins by itself after a drop; this says when it
 * drops. It keeps the mirror of the server's World (#164) in its own
 * Worker, for Try it.
 */
import type {
  FromMirror,
  MirrorChangeSet,
  MirrorSnapshot,
  ToMirror
} from 'mua-local';
import { Socket, type Channel } from 'phoenix';

import type { Adapter, Reply, WorldEvent } from './adapter';
import type { Builder, Editing } from './store';

// Phoenix's own timeout, longer than the Connection's: the Connection gives
// up first, the same for every World
const PUSH_TIMEOUT_MS = 30_000;

type Payload = Record<string, unknown>;

/** Plays one Character over its Channel, signed in with `token` */
export const channelAdapter = (token: string, character: number) => {
  let socket: Socket | undefined;
  let channel: Channel | undefined;
  let mirror: Worker | undefined;
  // replies to `snapshot`, in the order they were asked for
  const snapshots: ((snapshot: MirrorSnapshot | undefined) => void)[] = [];

  const toMirror = (message: ToMirror) => {
    if (!mirror) {
      mirror = new Worker('/local/mirror.js', { type: 'module' });
      mirror.addEventListener('message', ({ data }: MessageEvent<FromMirror>) =>
        snapshots.shift()?.(data.snapshot)
      );
    }
    mirror.postMessage(message);
  };

  const push = (type: string, payload: Payload) =>
    new Promise<Reply>(resolve => {
      if (!channel) {
        resolve({ ok: false, timeout: true });
        return;
      }
      channel
        .push(type, payload, PUSH_TIMEOUT_MS)
        .receive('ok', (reply?: Payload) =>
          resolve({ ok: true, payload: reply ?? {} })
        )
        .receive('error', ({ reason }: { reason: string }) =>
          resolve({ ok: false, reason })
        )
        .receive('timeout', () => resolve({ ok: false, timeout: true }));
    });

  const join = (listen: (event: WorldEvent) => void) => {
    const dropped = () => listen({ event: 'dropped' });
    socket = new Socket('/socket', { params: { token } });
    socket.onError(dropped);
    socket.onClose(dropped);
    socket.connect();

    channel = socket.channel(`character:${character}`);
    channel.on(
      'output',
      (output: { lines: string[]; suggestions?: string[] }) =>
        listen({ event: 'output', ...output })
    );
    channel.on(
      'picture',
      (picture: { alt: string; name: string; url: string }) =>
        listen({ event: 'picture', ...picture })
    );
    channel.on('prompt', (prompt: { options: string[]; text: string }) =>
      listen({ event: 'prompt', ...prompt })
    );
    channel.on('state', ({ actions }: { actions?: string[] }) =>
      listen({ actions: actions ?? [], event: 'state' })
    );
    channel.on('compose', (opened: Editing) =>
      listen({ event: 'compose', ...opened })
    );
    channel.on('closed', ({ eid }: { eid: number }) =>
      listen({ eid, event: 'closed' })
    );
    channel.on('status', ({ status }: { status: string }) => {
      if (status === 'limbo' || status === 'replaced') {
        listen({ event: 'status', status });
      }
    });
    // the server's World as the Character perceives it: fresh on every
    // join, then kept current Step by Step
    channel.on('mirror', (snapshot: MirrorSnapshot) =>
      toMirror({ snapshot, type: 'load' })
    );
    channel.on('changes', (changes: MirrorChangeSet) =>
      toMirror({ changes, type: 'apply' })
    );
    channel.onError(dropped);
    channel
      .join()
      .receive('ok', (reply?: { builder?: Builder | null }) =>
        listen({ builder: reply?.builder ?? null, event: 'joined' })
      )
      .receive('error', ({ reason }: { reason: string }) =>
        listen({ event: 'refused', reason })
      );
  };

  const adapter: Adapter = {
    // Phoenix would buffer a push while disconnected and send it on
    // rejoining, turning an offline command into a later action
    canSend: () => channel !== undefined && socket?.isConnected() === true,
    close: () => {
      socket?.disconnect();
      socket = undefined;
      channel = undefined;
      // nothing of the World stays in the browser once the Character has left
      mirror?.terminate();
      mirror = undefined;
    },
    join,
    logout: async () => {
      await push('logout', {});
    },
    request: push,
    snapshot: () =>
      new Promise<MirrorSnapshot | undefined>(resolve => {
        if (!mirror) {
          resolve(undefined);
          return;
        }
        snapshots.push(resolve);
        toMirror({ type: 'snapshot' });
      })
  };

  return { adapter, socket: () => socket };
};

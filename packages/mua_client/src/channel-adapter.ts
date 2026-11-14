/**
 * A server's World over its Phoenix Channel
 * (packages/mua_server/docs/protocol.md): the Connection's adapter for
 * playing online. Phoenix rejoins by itself after a drop; this says when it
 * drops. It keeps the mirror of the server's World (#164) in its own
 * Worker, for Try it.
 */
import type {
  MirrorChangeSet,
  MirrorReplies,
  MirrorSnapshot,
  ToMirror
} from 'mua-local';
import { connect as connectWorker, type Endpoint } from 'mua-local/endpoint';
import { Socket, type Channel } from 'phoenix';

import type { Adapter, Reply, WorldEvent } from './adapter';
import type { Builder, Editing } from './store';

// Phoenix's own timeout, longer than the Connection's: the Connection gives
// up first, the same for every World
const PUSH_TIMEOUT_MS = 30_000;

type Payload = Record<string, unknown>;

const errorOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// a mirror that failed to take a snapshot or change set says so when Try
// it next asks for it
const warn = (what: string) => (error: unknown) =>
  // for whoever is debugging: the player hears of it from Try it
  // eslint-disable-next-line no-console
  console.warn(`The mirror couldn't ${what}: ${errorOf(error)}`);

/** Plays one Character over its Channel, signed in with `token` */
export const channelAdapter = (token: string, character: number) => {
  let socket: Socket | undefined;
  let channel: Channel | undefined;
  // once its Worker dies it stays closed, and Try it can't read it, until
  // the server sends the next `mirror` (#314)
  let mirror: Endpoint<ToMirror, MirrorReplies> | undefined;

  // only a fresh snapshot starts a Worker: a change set needs one to apply to
  const loadMirror = (snapshot: MirrorSnapshot) => {
    if (!mirror || mirror.closed()) {
      mirror = connectWorker(
        new Worker('/local/mirror.js', { type: 'module' })
      );
    }
    mirror.request({ snapshot, type: 'load' }).catch(warn('load'));
  };

  const applyToMirror = (changes: MirrorChangeSet) => {
    if (mirror && !mirror.closed()) {
      mirror.request({ changes, type: 'apply' }).catch(warn('apply a Step'));
    }
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
    channel.on('mirror', loadMirror);
    channel.on('changes', applyToMirror);
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
      mirror?.close();
      mirror = undefined;
    },
    join,
    logout: async () => {
      await push('logout', {});
    },
    request: push,
    // rejects if the mirror is out of step with the server's World, or its
    // Worker died
    snapshot: async () => {
      if (!mirror) {
        return undefined;
      }
      try {
        return await mirror.request({ type: 'snapshot' });
      } catch (error) {
        throw new Error(
          `Try it couldn't read where you stand: ${errorOf(error)}. Reconnect to try again.`
        );
      }
    }
  };

  return { adapter, socket: () => socket };
};

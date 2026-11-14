/**
 * The adapter for a Local World (ADR 0023): its messages are the Channel's,
 * with each reply sent back as `reply` with the request's `ref`. The Worker
 * adapter carries them over `postMessage`; tests carry them to a Local
 * World's host in the same process.
 */
import type { FromWorld, MirrorSnapshot, ToWorld } from 'mua-local';

import { ignore, type Adapter, type Reply, type WorldEvent } from './adapter';
import type { Builder } from './store';

export type LocalAdapterOptions = {
  /** Lets go of the Local World, once its Character is in Limbo */
  close: () => void;
  /** Offers a saved World's bytes to keep, as a file */
  keep: (bytes: Uint8Array) => void;
  /** The Character's name, to make it the first time and join it again */
  name: string;
  /** Hands a message to the Local World */
  post: (message: ToWorld) => void;
};

/**
 * A Local World's adapter, and `receive` to hand it each message the World
 * sends
 */
export const localAdapter = ({
  close,
  keep,
  name,
  post
}: LocalAdapterOptions) => {
  let listen: (event: WorldEvent) => void = ignore;
  let refs = 0;
  const pending = new Map<string, (reply: Reply) => void>();
  // replies to `snapshot` and `logout`, in the order they were asked for
  const snapshots: ((snapshot: MirrorSnapshot | undefined) => void)[] = [];
  const logouts: (() => void)[] = [];
  let open = true;

  const receive = (message: FromWorld) => {
    switch (message.event) {
      case 'reply': {
        const answer =
          message.ref === undefined ? undefined : pending.get(`${message.ref}`);
        if (!answer) {
          return;
        }
        pending.delete(`${message.ref}`);
        if (message.ok) {
          const { event: _event, ok: _ok, ref: _ref, ...payload } = message;
          answer({ ok: true, payload });
        } else {
          answer({ ok: false, reason: message.reason });
        }
        return;
      }
      case 'snapshot':
        snapshots.shift()?.(message.snapshot);
        return;
      case 'joined':
        // a Local World's Builder always has its limits (#292)
        listen({ builder: message.builder as Builder | null, event: 'joined' });
        return;
      case 'state':
        listen({ actions: message.state.actions, event: 'state' });
        return;
      case 'status':
        // `joined` says the Character is in play
        if (message.status === 'limbo') {
          for (const done of logouts.splice(0)) {
            done();
          }
          listen({ event: 'status', status: 'limbo' });
        }
        return;
      case 'saved':
        keep(message.bytes);
        listen({ event: 'saved' });
        return;
      case 'loaded':
        listen({ event: 'loaded' });
        // the saved World plays from here on, with its own Character
        post({ name, type: 'join' });
        return;
      case 'error':
        listen({ event: 'stopped', message: message.message });
        return;
      default:
        listen(message);
    }
  };

  const adapter: Adapter = {
    canSend: () => open,
    close: () => {
      open = false;
      close();
    },
    join: listener => {
      listen = listener;
      post({ name, type: 'join' });
    },
    load: bytes => post({ bytes, type: 'load' }),
    logout: () =>
      new Promise<void>(resolve => {
        logouts.push(resolve);
        post({ type: 'logout' });
      }),
    request: (type, payload) =>
      new Promise<Reply>(resolve => {
        const ref = `r${++refs}`;
        pending.set(ref, resolve);
        post({ ...payload, ref, type } as ToWorld);
      }),
    save: () => post({ type: 'save' }),
    snapshot: () =>
      new Promise<MirrorSnapshot | undefined>(resolve => {
        snapshots.push(resolve);
        post({ type: 'snapshot' });
      })
  };

  return { adapter, receive };
};

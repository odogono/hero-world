/**
 * Keeps the client's Mirror of the server's World (#164) in its own Worker,
 * for Try it. The server sends a `mirror` on joining and `changes` after
 * each Step. When the Mirror falls out of step, or its Worker dies, Try it
 * asks the server for a fresh one and plays on, without reconnecting
 * (#314).
 */
import type {
  MirrorChangeSet,
  MirrorReplies,
  MirrorSnapshot,
  ToMirror
} from 'mua-local';
import { connect, type Endpoint, type WorkerLike } from 'mua-local/endpoint';

import type { Reply } from './adapter';

export type MirrorKeeperOptions = {
  /** Asks the server for a fresh `mirror` */
  ask: () => Promise<Reply>;
  /** Starts a Worker to hold the Mirror */
  start: () => WorkerLike;
};

const errorOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// a mirror that failed to take a snapshot or change set says so when Try
// it next asks for it
const warn = (what: string) => (error: unknown) =>
  // for whoever is debugging: the player hears of it from Try it
  // eslint-disable-next-line no-console
  console.warn(`The mirror couldn't ${what}: ${errorOf(error)}`);

export const mirrorKeeper = ({ ask, start }: MirrorKeeperOptions) => {
  // Until a fresh `mirror` arrives the old one is closed, or out of step and
  // passes `changes` over: the Channel answers in order, so those are in
  // the fresh one already
  let mirror: Endpoint<ToMirror, MirrorReplies> | undefined;

  const load = (snapshot: MirrorSnapshot) => {
    if (!mirror || mirror.closed()) {
      mirror = connect(start());
    }
    mirror.request({ snapshot, type: 'load' }).catch(warn('load'));
  };

  const apply = (changes: MirrorChangeSet) => {
    if (mirror && !mirror.closed()) {
      mirror.request({ changes, type: 'apply' }).catch(warn('apply a Step'));
    }
  };

  // a fresh `mirror` from the server, in a new Worker
  const refresh = async () => {
    const reply = await ask();
    if (!reply.ok) {
      throw new Error(
        'reason' in reply ? reply.reason : 'No answer from the World yet.'
      );
    }
    const snapshot = reply.payload as MirrorSnapshot;
    mirror?.close();
    mirror = undefined;
    load(snapshot);
    return snapshot;
  };

  return {
    /** Starts the Mirror afresh from the server's `mirror` */
    load,
    /** Applies a Step's `changes` from the server */
    apply,
    /** Lets go of the Mirror's Worker */
    close: () => {
      mirror?.close();
      mirror = undefined;
    },
    /**
     * A Snapshot of what the Character perceives, for Try it (#259). A
     * Mirror out of step, dead or never loaded is fetched afresh, once;
     * rejects if that fails too.
     */
    snapshot: async (): Promise<MirrorSnapshot> => {
      if (mirror && !mirror.closed()) {
        try {
          const taken = await mirror.request({ type: 'snapshot' });
          if (taken) {
            return taken;
          }
        } catch {
          // out of step, or its Worker died: ask the server
        }
      }
      try {
        return await refresh();
      } catch (error) {
        throw new Error(
          `Try it couldn't read where you stand: ${errorOf(error)}`
        );
      }
    }
  };
};

export type MirrorKeeper = ReturnType<typeof mirrorKeeper>;

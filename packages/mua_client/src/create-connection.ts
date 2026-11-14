/**
 * A Connection (#304): this browser's link to a World, a server's or a Local
 * World, through which the Player controls their Character. It plays the
 * World the same way whichever adapter reaches it, writing what the World
 * says into the store, and answering what Play and the Composer ask.
 */
import type { MirrorSnapshot } from 'mua-local';

import type { Adapter, Reply, WorldEvent } from './adapter';
import {
  actions,
  builder,
  editing,
  lines,
  saving,
  status,
  type Builder
} from './store';
import {
  append,
  confirmed,
  connectionLost,
  rejoined,
  sent,
  unconfirmed
} from './transcript';

/** How long a request waits for the World before giving up on it */
export const REQUEST_TIMEOUT_MS = 10_000;

// a Snapshot the World didn't give in time
const NO_ANSWER = Symbol('no answer');

/** What a place came to: the thing's id, or the World's reason for refusing */
export type Placed = { eid: number; ok: true } | { ok: false; reason: string };

/** What saving an edit came to: done, or the World's reason for refusing */
export type Saved = { ok: true } | { ok: false; reason: string };

/**
 * A patch to a placed thing: the components to add or change, with only
 * the properties that changed, and those to remove
 */
export type Patch = {
  put: Record<string, Record<string, unknown>>;
  remove: string[];
};

/** What the Composer can do to the placed thing it has open, besides save */
export type PutAway = 'destroy' | 'store';

const NOT_CONNECTED = "You aren't connected.";

const add = (line: Parameters<typeof append>[1]) => {
  lines.value = append(lines.value, line);
};

// the World's count of what the Account has placed, after a place, store
// or destroy
const counted = (payload: Record<string, unknown>) => {
  if (builder.value) {
    builder.value = {
      ...builder.value,
      max_placed: payload.max_placed as Builder['max_placed'],
      placed: payload.placed as number
    };
  }
};

export type ConnectionOptions = {
  /** How long a request waits for the World; REQUEST_TIMEOUT_MS by default */
  timeout?: number;
};

/** Plays the Character through `adapter`, from now on */
export const createConnection = (
  adapter: Adapter,
  { timeout = REQUEST_TIMEOUT_MS }: ConnectionOptions = {}
) => {
  let joinedBefore = false;

  // a request's answer or failure, or none once the timeout has passed
  const within = <T>(answer: Promise<T>, none: T) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => resolve(none), timeout);
      answer.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });

  const ask = (type: Parameters<Adapter['request']>[0], payload = {}) =>
    within<Reply>(adapter.request(type, payload), {
      ok: false,
      timeout: true
    });

  const ready = () => status.value === 'joined' && adapter.canSend();

  const listen = (event: WorldEvent) => {
    switch (event.event) {
      case 'output':
        event.lines.forEach((text, i) =>
          add(
            // the Suggestions go with the last line
            event.suggestions?.length && i === event.lines.length - 1
              ? { kind: 'output', suggestions: event.suggestions, text }
              : { kind: 'output', text }
          )
        );
        return;
      case 'picture':
        add({
          alt: event.alt,
          kind: 'picture',
          name: event.name,
          url: event.url
        });
        return;
      case 'prompt':
        add({ kind: 'prompt', options: event.options, text: event.text });
        return;
      case 'state':
        actions.value = event.actions;
        return;
      case 'joined':
        builder.value = event.builder;
        if (joinedBefore) {
          lines.value = rejoined(lines.value);
        }
        joinedBefore = true;
        status.value = 'joined';
        return;
      case 'refused':
        add({ kind: 'error', text: `Couldn't join: ${event.reason}` });
        return;
      case 'status':
        if (event.status === 'replaced') {
          status.value = 'replaced';
          add({
            kind: 'status',
            text: 'You are playing in another window now.'
          });
        } else {
          status.value = 'limbo';
          add({ kind: 'status', text: 'You have left the world.' });
        }
        return;
      case 'compose': {
        const { event: _event, ...opened } = event;
        editing.value = opened;
        return;
      }
      case 'closed':
        // the World closed it, as when someone stored or destroyed it (#284)
        if (editing.value?.eid === event.eid) {
          editing.value = null;
        }
        return;
      case 'dropped':
        if (status.value === 'joined') {
          status.value = 'offline';
          lines.value = connectionLost(lines.value);
        }
        return;
      case 'stopped':
        add({ kind: 'error', text: `The world stopped: ${event.message}` });
        status.value = 'offline';
        return;
      case 'saved':
        add({ kind: 'status', text: 'Saved your world as mua-world.db.' });
        return;
      case 'loaded':
        // the saved World plays from here on, with its own Character: what
        // was open in the old one is gone
        lines.value = [];
        actions.value = [];
        editing.value = null;
        joinedBefore = false;
        add({ kind: 'status', text: 'Loaded a saved world.' });
        status.value = 'connecting';
        return;
      case 'loadFailed':
        add({ kind: 'error', text: `Not loaded: ${event.message}` });
        return;
    }
  };

  saving.value = adapter.save !== undefined;
  adapter.join(listen);

  return {
    /**
     * Sends a command, only while joined and the World can hear it now, so
     * an offline command never becomes a later action
     */
    sendCommand: (text: string) => {
      if (!ready()) {
        return false;
      }
      const [next, ref] = sent(lines.value, text);
      lines.value = next;
      void ask('command', { ref, text }).then(reply => {
        if (reply.ok) {
          lines.value = confirmed(lines.value, ref);
          return;
        }
        lines.value = unconfirmed(lines.value, ref);
        if ('reason' in reply) {
          add({ kind: 'error', text: `Not sent: ${reply.reason}` });
        }
      });
      return true;
    },

    /**
     * Places a thing a Builder composed in the Character's room (#258): a
     * map of component names to their data. The World checks it all.
     */
    place: async (composition: Record<string, unknown>): Promise<Placed> => {
      if (!ready()) {
        return { ok: false, reason: NOT_CONNECTED };
      }
      const reply = await ask('place', { composition });
      if (reply.ok) {
        counted(reply.payload);
        return { eid: reply.payload.eid as number, ok: true };
      }
      return 'reason' in reply
        ? reply
        : // it may have been placed: the World says, in the transcript
          { ok: false, reason: 'No answer from the World yet.' };
    },

    /**
     * Saves an edit to the placed thing the `edit` Verb opened (#275). The
     * World checks it all; a saved edit closes the thing, a refused one
     * leaves it open.
     */
    saveEdit: async (eid: number, patch: Patch): Promise<Saved> => {
      if (!ready()) {
        return { ok: false, reason: NOT_CONNECTED };
      }
      const reply = await ask('edit', { eid, patch });
      if (reply.ok) {
        editing.value = null;
        return { ok: true };
      }
      return 'reason' in reply
        ? reply
        : {
            ok: false,
            reason: 'No answer from the World yet: it may have been saved.'
          };
    },

    /**
     * Stores or destroys the placed thing the `edit` Verb opened, as the
     * `store` and `destroy` Verbs do (#284). The World checks it all; done,
     * it closes the thing, and refused, it leaves it open.
     */
    putAway: async (eid: number, verb: PutAway): Promise<Saved> => {
      if (!ready()) {
        return { ok: false, reason: NOT_CONNECTED };
      }
      const reply = await ask(verb, { eid });
      if (reply.ok) {
        editing.value = null;
        counted(reply.payload);
        return { ok: true };
      }
      return 'reason' in reply
        ? reply
        : {
            ok: false,
            reason: 'No answer from the World yet: it may have been done.'
          };
    },

    /** Closes the thing the `edit` Verb opened, without saving */
    stopEditing: () => {
      editing.value = null;
      if (ready()) {
        void ask('stop_editing');
      }
    },

    /**
     * A Snapshot of what the Character perceives, as it is now, for Try it
     * (#259), or undefined while there is none. Rejects when one can't be
     * read, or the World doesn't answer in time (#313).
     */
    snapshot: async () => {
      const taken = await within<MirrorSnapshot | undefined | typeof NO_ANSWER>(
        adapter.snapshot(),
        NO_ANSWER
      );
      if (taken === NO_ANSWER) {
        throw new Error(
          "Try it couldn't read where you stand: No answer from the World yet."
        );
      }
      return taken;
    },

    /** Saves the World as a file, where it can be */
    save: () => adapter.save?.(),

    /** Loads a saved World from a file, in place of this one, where it can be */
    load: async (file: Blob) => {
      if (adapter.load) {
        adapter.load(new Uint8Array(await file.arrayBuffer()));
      }
    },

    /**
     * Leaves the World: the Character goes to Limbo at once, and nothing of
     * the World stays in the browser
     */
    logout: async () => {
      if (status.value === 'joined') {
        await within(adapter.logout(), undefined);
      }
      adapter.close();
      editing.value = null;
      builder.value = null;
      saving.value = false;
    },

    /** Lets go of the World without leaving it, as when another replaces it */
    close: () => adapter.close()
  };
};

export type Connection = ReturnType<typeof createConnection>;

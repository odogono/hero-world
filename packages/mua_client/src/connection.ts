import type {
  FromWorld,
  MirrorChangeSet,
  MirrorReplies,
  MirrorSnapshot,
  ToMirror
} from 'mua-local';
import { connect as connectWorker, type Endpoint } from 'mua-local/endpoint';
import { Socket, type Channel } from 'phoenix';

import {
  actions,
  builder,
  editing,
  lines,
  status,
  type Builder,
  type Editing
} from './store';
import {
  append,
  confirmed,
  connectionLost,
  rejoined,
  sent,
  unconfirmed
} from './transcript';

type Output = { lines: string[]; suggestions?: string[] };
type Picture = { alt: string; name: string; url: string };
type Prompt = { options: string[]; text: string };
type State = { actions?: string[] };
type Status = { status: 'connected' | 'limbo' | 'replaced' };

let socket: Socket | undefined;
let channel: Channel | undefined;
/** A Local World's Worker, while playing offline (ADR 0023) */
let worker: Worker | undefined;
/**
 * The mirror of the server's World, while playing online (#164). Once its
 * Worker dies it stays closed, and Try it can't read it, until the server
 * sends the next `mirror` (#314).
 */
let mirror: Endpoint<ToMirror, MirrorReplies> | undefined;
/** The local Character's name, to join again after loading a save */
let localName = '';

const errorOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// a mirror that failed to take a snapshot or change set says so when Try
// it next asks for it
const warn = (what: string) => (error: unknown) =>
  // for whoever is debugging: the player hears of it from Try it
  // eslint-disable-next-line no-console
  console.warn(`The mirror couldn't ${what}: ${errorOf(error)}`);

// only a fresh snapshot starts a Worker: a change set needs one to apply to
const loadMirror = (snapshot: MirrorSnapshot) => {
  if (!mirror || mirror.closed()) {
    mirror = connectWorker(new Worker('/local/mirror.js', { type: 'module' }));
  }
  mirror.request({ snapshot, type: 'load' }).catch(warn('load'));
};

const applyToMirror = (changes: MirrorChangeSet) => {
  if (mirror && !mirror.closed()) {
    mirror.request({ changes, type: 'apply' }).catch(warn('apply a Step'));
  }
};

/**
 * The mirror of what the Character perceives, as it is now, for Try it
 * (#259), or undefined while there is none. Rejects if the mirror is out of
 * step with the server's World, or its Worker died.
 */
export const mirrorSnapshot = async () => {
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
};

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
  channel.on('output', ({ lines: told, suggestions }: Output) => {
    told.forEach((text, i) =>
      add(
        // the Suggestions go with the last line
        suggestions?.length && i === told.length - 1
          ? { kind: 'output', suggestions, text }
          : { kind: 'output', text }
      )
    );
  });
  // a place's Picture, just before its description (ADR 0027)
  channel.on('picture', ({ alt, name, url }: Picture) =>
    add({ alt, kind: 'picture', name, url })
  );
  // a placed thing the `edit` Verb opened, for the Composer (#275)
  channel.on('compose', (opened: Editing) => {
    editing.value = opened;
  });
  // the World closed it, as when someone stored or destroyed it (#284)
  channel.on('closed', ({ eid }: { eid: number }) => {
    if (editing.value?.eid === eid) {
      editing.value = null;
    }
  });
  channel.on('state', ({ actions: next }: State) => {
    actions.value = next ?? [];
  });
  // the server's World as the Character perceives it: fresh on every join,
  // then kept current Step by Step
  channel.on('mirror', loadMirror);
  channel.on('changes', applyToMirror);
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
    .receive('ok', (reply?: { builder?: Builder | null }) => {
      builder.value = reply?.builder ?? null;
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
  // building in a Local World is for later (#265)
  builder.value = null;
  localName = name;
  worker = new Worker('/local/worker.js', { type: 'module' });
  worker.addEventListener('message', ({ data }: MessageEvent<FromWorld>) => {
    switch (data.event) {
      case 'output':
        for (const text of data.lines) {
          add({ kind: 'output', text });
        }
        break;
      case 'picture':
        add({ alt: data.alt, kind: 'picture', name: data.name, url: data.url });
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
      case 'saved':
        download(data.bytes);
        add({ kind: 'status', text: 'Saved your world as mua-world.db.' });
        break;
      case 'loaded':
        // the saved World plays from here on, with its own Character
        lines.value = [];
        add({ kind: 'status', text: 'Loaded a saved world.' });
        status.value = 'connecting';
        worker?.postMessage({ name: localName, type: 'join' });
        break;
      case 'loadFailed':
        add({ kind: 'error', text: `Not loaded: ${data.message}` });
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

// Offers a save to the browser to keep, as a file
const download = (bytes: Uint8Array) => {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mua-world.db';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Saves the Local World as a file the browser downloads */
export const saveLocal = () => worker?.postMessage({ type: 'save' });

/** Loads a saved World from a file, in place of the Local World */
export const loadLocal = async (file: Blob) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  worker?.postMessage({ bytes, type: 'load' }, [bytes.buffer]);
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

/** What a place came to: the thing's id, or the World's reason for refusing */
export type Placed = { eid: number; ok: true } | { ok: false; reason: string };

/**
 * Places a thing a Builder composed in the Character's room (#258): a map
 * of component names to their data. The World checks it all.
 */
export const place = (composition: Record<string, unknown>) =>
  new Promise<Placed>(resolve => {
    if (!channel || status.value !== 'joined' || !socket?.isConnected()) {
      resolve({ ok: false, reason: "You aren't connected." });
      return;
    }
    channel
      .push('place', { composition })
      .receive('ok', (reply: { eid: number } & Builder) => {
        if (builder.value) {
          builder.value = {
            ...builder.value,
            max_placed: reply.max_placed,
            placed: reply.placed
          };
        }
        resolve({ eid: reply.eid, ok: true });
      })
      .receive('error', ({ reason }: { reason: string }) =>
        resolve({ ok: false, reason })
      )
      // it may have been placed: the World says, in the transcript
      .receive('timeout', () =>
        resolve({ ok: false, reason: 'No answer from the World yet.' })
      );
  });

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

let edits = 0;

/**
 * Saves an edit to the placed thing the `edit` Verb opened (#275). The
 * World checks it all; a saved edit closes the thing, a refused one leaves
 * it open.
 */
export const saveEdit = (eid: number, patch: Patch) =>
  new Promise<Saved>(resolve => {
    if (!channel || status.value !== 'joined' || !socket?.isConnected()) {
      resolve({ ok: false, reason: "You aren't connected." });
      return;
    }
    channel
      .push('edit', { eid, patch, ref: `edit-${++edits}` })
      .receive('ok', () => {
        editing.value = null;
        resolve({ ok: true });
      })
      .receive('error', ({ reason }: { reason: string }) =>
        resolve({ ok: false, reason })
      )
      .receive('timeout', () =>
        resolve({
          ok: false,
          reason: 'No answer from the World yet: it may have been saved.'
        })
      );
  });

/** What the Composer can do to the placed thing it has open, besides save */
export type PutAway = 'destroy' | 'store';

let putAways = 0;

/**
 * Stores or destroys the placed thing the `edit` Verb opened, as the
 * `store` and `destroy` Verbs do (#284). The World checks it all; done, it
 * closes the thing, and refused, it leaves it open.
 */
export const putAway = (eid: number, verb: PutAway) =>
  new Promise<Saved>(resolve => {
    if (!channel || status.value !== 'joined' || !socket?.isConnected()) {
      resolve({ ok: false, reason: "You aren't connected." });
      return;
    }
    channel
      .push(verb, { eid, ref: `${verb}-${++putAways}` })
      .receive('ok', (reply: Pick<Builder, 'max_placed' | 'placed'>) => {
        editing.value = null;
        if (builder.value) {
          builder.value = {
            ...builder.value,
            max_placed: reply.max_placed,
            placed: reply.placed
          };
        }
        resolve({ ok: true });
      })
      .receive('error', ({ reason }: { reason: string }) =>
        resolve({ ok: false, reason })
      )
      .receive('timeout', () =>
        resolve({
          ok: false,
          reason: 'No answer from the World yet: it may have been done.'
        })
      );
  });

/** Closes the thing the `edit` Verb opened, without saving */
export const stopEditing = () => {
  editing.value = null;
  if (channel && status.value === 'joined') {
    channel.push('stop_editing', {});
  }
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
    // nothing of the World stays in the browser once the Character has left
    editing.value = null;
    mirror?.close();
    mirror = undefined;
  });

/** The socket, for the browser checks to cut its Connection */
export const currentSocket = () => socket;

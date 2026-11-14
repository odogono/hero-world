/**
 * The Connection the UI plays through (#304): one at a time, to a server's
 * World over its Channel or to a Local World in its Worker. Play and the
 * Composer call these without knowing which World they're in.
 */
import type { Socket } from 'phoenix';

import { channelAdapter } from './channel-adapter';
import {
  createConnection,
  type Connection,
  type Patch,
  type PutAway
} from './create-connection';
import { workerAdapter } from './worker-adapter';

export type { Patch, Placed, PutAway, Saved } from './create-connection';

let current: Connection | undefined;
/** The server's socket, while playing online, for the browser checks */
let socket: () => Socket | undefined = () => undefined;

const replace = (connection: Connection) => {
  current?.close();
  current = connection;
};

/** Plays one Character of a server's World over its Channel */
export const connect = (token: string, character: number) => {
  const channel = channelAdapter(token, character);
  socket = channel.socket;
  replace(createConnection(channel.adapter));
};

/**
 * Plays a Local World offline, in a Web Worker (ADR 0023). Its Character is
 * made with `name` the first time, and played again after a reload.
 */
export const connectLocal = (name: string) => {
  socket = () => undefined;
  replace(createConnection(workerAdapter(name)));
};

export const sendCommand = (text: string) =>
  current?.sendCommand(text) ?? false;

export const place = (composition: Record<string, unknown>) =>
  current
    ? current.place(composition)
    : Promise.resolve({ ok: false as const, reason: "You aren't connected." });

export const saveEdit = (eid: number, patch: Patch) =>
  current
    ? current.saveEdit(eid, patch)
    : Promise.resolve({ ok: false as const, reason: "You aren't connected." });

export const putAway = (eid: number, verb: PutAway) =>
  current
    ? current.putAway(eid, verb)
    : Promise.resolve({ ok: false as const, reason: "You aren't connected." });

export const stopEditing = () => current?.stopEditing();

export const mirrorSnapshot = () =>
  current ? current.snapshot() : Promise.resolve(undefined);

export const saveLocal = () => current?.save();

export const loadLocal = (file: Blob) => current?.load(file);

/** Leaves the World: the Character goes to Limbo at once */
export const logout = async () => {
  await current?.logout();
  current = undefined;
};

/** The socket, for the browser checks to cut its Connection */
export const currentSocket = () => socket();

/**
 * The messages between the UI and a Local World's Worker: the Phoenix
 * Channel's (packages/mua_server/docs/protocol.md), so `mua_client` can't
 * tell a Local World from a server's (ADR 0023). A Channel message's reply
 * comes back as `reply`, with the same `ref` and payload.
 *
 * A message's form is checked here, as `MuaServer.Protocol` checks it,
 * function for function and with the same reasons, which the shared cases
 * in `spec/mua/protocol` pin. The one reason only a Local World gives is
 * `not_joined`, for a message before `join`: a Channel can't receive one.
 */
import type { Editing, MirrorSnapshot, Patch, View } from 'mua-world';

/** A message's `ref`: text or a whole number, or null as on the Channel */
type Ref = number | string | null;

/** From the UI */
export type ToWorld =
  /** Starts the World and plays its Character, made with `name` the first time */
  | { name: string; type: 'join' }
  | { ref: Ref; text: string; type: 'command' }
  | { type: 'logout' }
  /** Saves the World: replied to with `saved` */
  | { type: 'save' }
  /** Loads a saved World in place of this one: replied to with `loaded` or `loadFailed` */
  | { bytes: Uint8Array; type: 'load' }
  /** Places a thing the Builder composed in the Character's room (#258) */
  | { composition: Record<string, unknown>; ref?: Ref; type: 'place' }
  /** Saves an edit to the thing the `edit` Verb opened (#274) */
  | { eid: number; patch: Patch; ref?: Ref; type: 'edit' }
  /** Stores or destroys the thing the `edit` Verb opened (#284) */
  | { eid: number; ref?: Ref; type: 'destroy' | 'store' }
  /** Closes the thing the `edit` Verb opened without saving */
  | { ref?: Ref; type: 'stop_editing' }
  /**
   * Asks for a Snapshot of what the Character perceives, for Try it (#259):
   * replied to with `reply`, refused while no Character has joined (#313)
   */
  | { ref?: Ref; type: 'snapshot' };

/** An Account's building limits and count, as the Channel's join replies */
export type Builder = {
  max_capacity: number | undefined;
  max_placed: number | undefined;
  placed: number;
};

/** From the World */
export type FromWorld =
  /** `suggestions` are Commands the last line offers, to send in one click */
  | { event: 'output'; lines: string[]; suggestions?: string[] }
  /** A place's Picture, just before its description (ADR 0027) */
  | { alt: string; event: 'picture'; name: string; url: string }
  | { event: 'prompt'; options: string[]; text: string }
  | { event: 'state'; state: View }
  | { event: 'status'; status: 'connected' | 'limbo' }
  /** The reply to a `join`: `builder` is null for an Account that doesn't build */
  | { builder: Builder | null; character: number; event: 'joined' }
  /** The reply to a `command` or `stop_editing`, once its Step has committed */
  | { event: 'reply'; ok: true; ref?: Ref }
  /** The reply to a `snapshot` */
  | { event: 'reply'; ok: true; ref?: Ref; snapshot: MirrorSnapshot }
  /** The reply to an `edit`, once it is saved */
  | { eid: number; event: 'reply'; ok: true; ref?: Ref }
  /** The reply to a `place`, `store` or `destroy`: the Account's count after it */
  | {
      eid: number;
      event: 'reply';
      max_placed: number | undefined;
      ok: true;
      placed: number;
      ref?: Ref;
    }
  | { event: 'reply'; ok: false; reason: string; ref?: Ref }
  /** The placed thing the `edit` Verb opened, on opening and on rejoining */
  | ({ event: 'compose' } & Editing)
  /** The World closed the thing the Character had open, as when it was stored */
  | { eid: number; event: 'closed' }
  /** The World as an SQLite file, to download */
  | { bytes: Uint8Array; event: 'saved' }
  /** A loaded World plays from now on: `join` again to play it */
  | { event: 'loaded' }
  /** The file wasn't a World this can play, and the World is as it was */
  | { event: 'loadFailed'; message: string }
  /** The World couldn't start or carry on */
  | { event: 'error'; message: string };

/** Commands are at most this many characters once trimmed, as on the server */
const MAX_TEXT = 500;

const REF = 'ref must be text or a number';

/** Why a message's form was refused, before the World saw it */
export type Refused = { refused: string };

const isRef = (ref: unknown): ref is Ref | undefined =>
  ref == null || typeof ref === 'string' || Number.isInteger(ref);

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Characters as Elixir's `String.length` counts them: graphemes
const length = (text: string) => [...new Intl.Segmenter().segment(text)].length;

/** A `command`, as `MuaServer.Protocol.command/1` checks it */
export const checkCommand = (
  m: Record<string, unknown>
): Refused | { ref: Ref | undefined; text: string } => {
  if (typeof m.text !== 'string') {
    return { refused: 'a command needs text' };
  }
  const text = m.text.trim();
  if (text === '') {
    return { refused: 'empty command' };
  }
  if (length(text) > MAX_TEXT) {
    return { refused: 'command too long' };
  }
  return isRef(m.ref) ? { ref: m.ref, text } : { refused: REF };
};

/** A `place`, as `MuaServer.Protocol.place/1` checks it */
export const checkPlace = (
  m: Record<string, unknown>
): Refused | { composition: Record<string, unknown>; ref: Ref | undefined } => {
  if (!isMap(m.composition)) {
    return { refused: 'a place needs a composition' };
  }
  return isRef(m.ref)
    ? { composition: m.composition, ref: m.ref }
    : { refused: REF };
};

/** An `edit`, as `MuaServer.Protocol.edit/1` checks it */
export const checkEdit = (
  m: Record<string, unknown>
): Refused | { eid: number; patch: Patch; ref: Ref | undefined } => {
  if (!Number.isInteger(m.eid) || !isMap(m.patch)) {
    return { refused: 'an edit needs an eid and a patch' };
  }
  return isRef(m.ref)
    ? { eid: m.eid as number, patch: m.patch as Patch, ref: m.ref }
    : { refused: REF };
};

/** A `store` or `destroy`, as `MuaServer.Protocol.thing/1` checks it */
export const checkThing = (
  m: Record<string, unknown>
): Refused | { eid: number; ref: Ref | undefined } => {
  if (!Number.isInteger(m.eid)) {
    return { refused: 'it needs the eid of the thing' };
  }
  return isRef(m.ref) ? { eid: m.eid as number, ref: m.ref } : { refused: REF };
};

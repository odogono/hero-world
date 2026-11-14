/**
 * The messages between the UI and a Local World's Worker: the Phoenix
 * Channel's (packages/mua_server/docs/protocol.md), so `mua_client` can't
 * tell a Local World from a server's (ADR 0023). A Channel message's reply
 * comes back as `reply`, with the same `ref` and payload.
 */
import type { Editing, MirrorSnapshot, Patch, View } from 'mua-world';

type Ref = number | string;

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

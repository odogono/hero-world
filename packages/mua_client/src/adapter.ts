/**
 * The seam between the Connection and the World it reaches (#304): a
 * server's World over the Phoenix Channel, or a Local World in its Worker
 * (ADR 0023). An adapter carries the Channel's messages
 * (packages/mua_server/docs/protocol.md) and hides how its transport
 * matches replies, drops and rejoins; the Connection does the rest, the
 * same for both.
 */
import type { MirrorSnapshot } from 'mua-local';

import type { Builder, Editing } from './store';

/** What the World tells the Connection, whichever World it is */
export type WorldEvent =
  /** `suggestions` are Commands the last line offers, to send in one click */
  | { event: 'output'; lines: string[]; suggestions?: string[] }
  /** A place's Picture, just before its description (ADR 0027) */
  | { alt: string; event: 'picture'; name: string; url: string }
  | { event: 'prompt'; options: string[]; text: string }
  /** Commands the Character could type next */
  | { actions: string[]; event: 'state' }
  /** The Character joined, or joined again: null for an Account that doesn't build */
  | { builder: Builder | null; event: 'joined' }
  /** Joining was refused */
  | { event: 'refused'; reason: string }
  /** The Character left the World, or another Connection took it over */
  | { event: 'status'; status: 'limbo' | 'replaced' }
  /** The placed thing the `edit` Verb opened, on opening and on rejoining */
  | ({ event: 'compose' } & Editing)
  /** The World closed the thing the Character had open */
  | { eid: number; event: 'closed' }
  /** The link to the World dropped; the adapter rejoins by itself */
  | { event: 'dropped' }
  /** The World couldn't start or carry on */
  | { event: 'stopped'; message: string }
  /** The World was saved as a file */
  | { event: 'saved' }
  /** A saved World plays from now on; the adapter joins it again */
  | { event: 'loaded' }
  /** The file wasn't a World this can play, and the World is as it was */
  | { event: 'loadFailed'; message: string };

/**
 * A request's answer: the World's reply payload, its reason for refusing,
 * or no answer at all
 */
export type Reply =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string }
  | { ok: false; timeout: true };

/** A message that asks the World for a reply */
export type RequestType =
  'command' | 'destroy' | 'edit' | 'place' | 'stop_editing' | 'store';

/** Listens to nothing, until something listens */
export const ignore = () => {};

export type Adapter = {
  /** Whether a request sent now would reach the World now, not later */
  canSend: () => boolean;
  /** Ends the link and lets go of what it holds */
  close: () => void;
  /** Starts the link and plays the Character, telling `listen` what happens */
  join: (listen: (event: WorldEvent) => void) => void;
  /** Loads a saved World in place of this one, where the World can be */
  load?: (bytes: Uint8Array) => void;
  /** Puts the Character in Limbo; resolves once it is there, or has no World */
  logout: () => Promise<void>;
  /**
   * Sends a request; never rejects. It may never resolve: the Connection
   * gives up on it after its own timeout.
   */
  request: (
    type: RequestType,
    payload: Record<string, unknown>
  ) => Promise<Reply>;
  /** Saves the World as a file, where the World can be saved */
  save?: () => void;
  /**
   * A mirror of what the Character perceives, for Try it (#259), or
   * undefined while there is none
   */
  snapshot: () => Promise<MirrorSnapshot | undefined>;
};

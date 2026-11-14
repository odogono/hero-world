/// <reference lib="webworker" />
/**
 * The Web Worker that holds a client's mirror of the server's World (#164):
 * an in-memory sqlite-wasm World of what the Character perceives. The UI
 * sends it the server's `mirror` and `changes` messages, in order, and asks
 * it for a snapshot for Try it (`endpoint.ts`).
 */
import { serve } from './endpoint';
import {
  mirrorHandler,
  openMirror,
  type MirrorReplies,
  type ToMirror
} from './mirror';

serve<ToMirror, MirrorReplies>(
  globalThis as unknown as DedicatedWorkerGlobalScope,
  mirrorHandler(openMirror({ path: ':memory:', type: 'wasm' }))
);

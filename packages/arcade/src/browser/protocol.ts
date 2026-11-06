import type { InputState } from '../sim/sim';

/** Floats per entity in a Frame message: kind, id, x, y, rotation, radius */
export const STRIDE = 6;

export const KIND = { asteroid: 0, bullet: 1, ship: 2 } as const;

/** What the page posts to the Worker */
export type ToWorker =
  { input: InputState; type: 'input' } | { seed: number; type: 'restart' };

/** What the Worker posts after each batch of Frames */
export type FromWorker =
  | {
      /** STRIDE floats per entity */
      entities: Float32Array;
      /** Median ms of the last 60 Frames, measured in the Worker */
      frameMs: number;
      lives: number;
      score: number;
      /** World time of this Frame, ms */
      time: number;
      type: 'frame';
      wave: number;
    }
  | { message: string; type: 'error' };

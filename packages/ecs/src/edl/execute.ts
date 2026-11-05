import type { Components } from '../types';
import type { World } from '../world';
import { EDLError } from './errors';
import type { ReadOptions } from './includes';
import { migrate } from './migrate';
import { edlRecord } from './record';

export type ExecuteOptions = ReadOptions;

/**
 * Builds a world from EDL: the Migration of an empty world (ADR 0007). It
 * throws on any unresolved reference, and on a world already built or
 * migrated from an EDL, which `migrateEDL` brings up to date instead.
 */
export const executeEDL = <T extends Components>(
  world: World<T>,
  edl: string,
  options: ExecuteOptions = {}
): void => {
  if (edlRecord(world).isBuilt()) {
    throw new EDLError(
      'This world has already been built from an EDL; use migrateEDL to bring it up to date'
    );
  }
  migrate(world, edl, { ...options, build: true });
};

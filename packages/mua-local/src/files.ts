/**
 * A Local World's files: its EDL, the Scripts the EDL names and
 * `mua-scripts`, by virtual path, so a Worker with no disk can read them.
 * The World's EDL is `/world/main.edl` and mua-scripts is `/mua-scripts`.
 */
export type WorldFiles = Readonly<Record<string, string>>;

export const EDL_PATH = '/world/main.edl';
export const SCRIPTS_DIR = '/mua-scripts';

/** A `readFile` over the bundled files */
export const reader = (files: WorldFiles) => (path: string) => {
  const source = files[path];
  if (source === undefined) {
    throw new Error(`No such file in the World's bundle: ${path}`);
  }
  return source;
};

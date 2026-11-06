/**
 * The few POSIX path operations EDL includes need, so the EDL reader runs
 * where `node:path` doesn't, such as a Web Worker (ADR 0023). Paths are
 * `/`-separated, as in a bundle of a World's files.
 */

const normalise = (path: string) => {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') {
        parts.pop();
      } else if (!absolute) {
        parts.push('..');
      }
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join('/');
  return absolute ? `/${joined}` : joined || '.';
};

export const isAbsolute = (path: string) => path.startsWith('/');

/** The directory of a path, as `path.dirname` gives it */
export const dirname = (path: string) => {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const i = trimmed.lastIndexOf('/');
  if (i === -1) {
    return '.';
  }
  return i === 0 ? '/' : trimmed.slice(0, i);
};

/**
 * Resolves paths right to left until one is absolute, as `path.resolve`
 * does; a result that stays relative is left relative, since there is no
 * working directory to anchor it to
 */
export const resolve = (...paths: string[]) => {
  let path = '';
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i]!;
    if (p === '') {
      continue;
    }
    path = path === '' ? p : `${p}/${path}`;
    if (isAbsolute(p)) {
      break;
    }
  }
  return normalise(path);
};

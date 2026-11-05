import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parseNodes, type EDLNode } from './compile';
import { EDLIncludeError, EDLParseError } from './errors';

export type ReadOptions = {
  /** Path of the .edl file; relative includes and `script.src` resolve against it */
  path?: string;
  /**
   * Reads an included file. Defaults to reading from disk; a host without
   * one, such as a Worker, passes its own.
   */
  readFile?: (file: string) => string;
  /** Named roots, `{ 'mua-scripts': dir }`, for includes written as `"mua-scripts:edl/base.edl"` */
  roots?: Record<string, string>;
};

/** An EDL's definitions with its includes read in, and the source its hash is taken from */
export type ReadEDL = { nodes: EDLNode[]; source: string };

const readFromDisk = (file: string) => readFileSync(file, 'utf8');

/**
 * Parses EDL source and reads in the files its `include` lines name (ADR
 * 0025). Each include is replaced in place by the definitions of the file it
 * names. A file is read once however often it is included, so includes may
 * repeat or form a cycle. A script in an included file resolves against that
 * file's directory.
 *
 * The source returned is the EDL's own source followed by each included
 * file's, so the World's EDL hash changes when an included file does. An EDL
 * with no includes keeps the hash of its source alone.
 */
export const readEDL = (edl: string, options: ReadOptions = {}): ReadEDL => {
  const { path, readFile = readFromDisk, roots = {} } = options;
  const seen = new Set<string>(path ? [resolve(path)] : []);
  const sources: string[] = [edl];

  const expand = (nodes: EDLNode[], from: string | undefined): EDLNode[] =>
    nodes.flatMap(node => {
      if (node.type !== 'include') {
        return [node];
      }
      const include = node.path ?? '';
      const file = resolveInclude(include, from, roots);
      if (seen.has(file)) {
        return [];
      }
      seen.add(file);
      const source = read(readFile, file, include);
      sources.push(source);
      return expand(
        parse(source, file).map(n => anchorScript(n, file)),
        file
      );
    });

  const nodes = expand(parseNodes(edl), path);
  return { nodes, source: sources.join('\n') };
};

const resolveInclude = (
  include: string,
  from: string | undefined,
  roots: Record<string, string>
): string => {
  const colon = include.indexOf(':');
  // a one-letter prefix is a drive letter, not a root
  if (colon > 1) {
    const root = include.slice(0, colon);
    const dir = roots[root];
    if (dir === undefined) {
      throw new EDLIncludeError(
        `include "${include}": no root named '${root}' is configured`,
        { include, root }
      );
    }
    return resolve(dir, include.slice(colon + 1));
  }
  if (isAbsolute(include)) {
    return resolve(include);
  }
  if (from === undefined) {
    throw new EDLIncludeError(
      `include "${include}": a relative include needs the EDL's path`,
      { include }
    );
  }
  return resolve(dirname(from), include);
};

const read = (
  readFile: (file: string) => string,
  file: string,
  include: string
): string => {
  try {
    return readFile(file);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new EDLIncludeError(
      `include "${include}": cannot read ${file}: ${reason}`,
      { file, include }
    );
  }
};

const parse = (source: string, file: string): EDLNode[] => {
  try {
    return parseNodes(source);
  } catch (error: unknown) {
    if (error instanceof EDLParseError) {
      throw new EDLParseError(`${file}: ${error.message}`, error.context);
    }
    throw error;
  }
};

/** A script in an included file is relative to that file, not the includer */
const anchorScript = (node: EDLNode, file: string): EDLNode => {
  const script = node.components?.script;
  const src = script?.src;
  if (
    (node.type !== 'atom' && node.type !== 'entity') ||
    typeof src !== 'string' ||
    src.length === 0
  ) {
    return node;
  }
  return {
    ...node,
    components: {
      ...node.components,
      script: { ...script, src: resolve(dirname(file), src) }
    }
  };
};

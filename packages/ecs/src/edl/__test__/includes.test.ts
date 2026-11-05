import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { EDLIncludeError, EDLParseError, isEDLChanged, readEDL } from '..';
import { defineComponent, s } from '../../component';
import { DatabaseType } from '../../db';
import { createWorld } from '../../world';

const files = (map: Record<string, string>) => (file: string) => {
  const source = map[file];
  if (source === undefined) {
    throw new Error('no such file');
  }
  return source;
};

const names = (edl: string, options: Parameters<typeof readEDL>[1]) =>
  readEDL(edl, options).nodes.map(node => node.id);

describe('readEDL', () => {
  it('reads an included file in place of its include line', () => {
    const readFile = files({
      '/game/rooms.edl': 'entity hall {}\nentity study {}'
    });
    const edl = 'entity first {}\ninclude "rooms.edl"\nentity last {}';

    expect(names(edl, { path: '/game/main.edl', readFile })).toEqual([
      'first',
      'hall',
      'study',
      'last'
    ]);
  });

  it('resolves an include through a named root', () => {
    const readFile = files({ '/pkg/edl/base.edl': 'atom base {}' });

    expect(
      names('include "lib:edl/base.edl"', {
        readFile,
        roots: { lib: '/pkg' }
      })
    ).toEqual(['base']);
  });

  it('resolves a nested include against the file that includes it', () => {
    const readFile = files({
      '/pkg/edl/base.edl': 'include "more/verbs.edl"',
      '/pkg/edl/more/verbs.edl': 'atom verbs {}'
    });

    expect(
      names('include "lib:edl/base.edl"', { readFile, roots: { lib: '/pkg' } })
    ).toEqual(['verbs']);
  });

  it('reads a file once, however often it is included', () => {
    const readFile = files({
      '/game/a.edl': 'include "b.edl"\natom a {}',
      '/game/b.edl': 'include "a.edl"\ninclude "main.edl"\natom b {}'
    });
    const edl = 'include "a.edl"\ninclude "b.edl"\natom main {}';

    expect(names(edl, { path: '/game/main.edl', readFile })).toEqual([
      'b',
      'a',
      'main'
    ]);
  });

  it("hashes the EDL's own source followed by each included file's", () => {
    const readFile = files({ '/game/rooms.edl': 'entity hall {}' });
    const edl = 'include "rooms.edl"';

    expect(readEDL(edl, { path: '/game/main.edl', readFile }).source).toBe(
      `${edl}\nentity hall {}`
    );
    expect(readEDL('entity solo {}').source).toBe('entity solo {}');
  });

  it("anchors an included file's scripts to that file", () => {
    const readFile = files({
      '/pkg/edl/base.edl':
        'atom door { script { src: "../scripts/door.talk" } }'
    });
    const [door] = readEDL('include "lib:edl/base.edl"', {
      readFile,
      roots: { lib: '/pkg' }
    }).nodes;

    expect(door?.components?.script?.src).toBe('/pkg/scripts/door.talk');
  });

  it('fails on a root that is not configured', () => {
    expect(() => readEDL('include "lib:base.edl"')).toThrow(
      new EDLIncludeError(
        `include "lib:base.edl": no root named 'lib' is configured`
      )
    );
  });

  it('fails on a relative include without the EDL path', () => {
    expect(() => readEDL('include "rooms.edl"')).toThrow(EDLIncludeError);
  });

  it('fails on a file it cannot read', () => {
    expect(() =>
      readEDL('include "missing.edl"', {
        path: '/game/main.edl',
        readFile: files({})
      })
    ).toThrow(/cannot read \/game\/missing\.edl/);
  });

  it('names the included file in its syntax errors', () => {
    expect(() =>
      readEDL('include "bad.edl"', {
        path: '/game/main.edl',
        readFile: files({ '/game/bad.edl': 'entity {' })
      })
    ).toThrow(EDLParseError);
    expect(() =>
      readEDL('include "bad.edl"', {
        path: '/game/main.edl',
        readFile: files({ '/game/bad.edl': 'entity {' })
      })
    ).toThrow(/^\/game\/bad\.edl: EDL syntax error/);
  });

  it('reads the Base Verbs into the command cases World from disk', () => {
    const repo = resolve(import.meta.dir, '../../../../..');
    const path = join(repo, 'spec/mua/commands/house.edl');
    const edl = readFileSync(path, 'utf8');
    const read = readEDL(edl, {
      path,
      roots: { 'mua-scripts': join(repo, 'packages/mua-scripts') }
    });
    const ids = read.nodes.map(node => node.id);

    expect(ids).toContain('base_verbs');
    expect(ids).toContain('ada');
    expect(ids.indexOf('base_verbs')).toBeLessThan(ids.indexOf('ada'));
  });
});

describe('building from an EDL with includes', () => {
  const described = defineComponent({
    id: 'described' as const,
    schema: { name: s.string() }
  });
  const script = defineComponent({
    id: 'script' as const,
    schema: { src: s.string() }
  });

  const build = async (rooms: string) => {
    const readFile = files({ '/game/rooms.edl': rooms });
    const world = await createWorld([described, script], {
      path: ':memory:',
      type: DatabaseType.BUN
    });
    const edl = 'include "rooms.edl"';
    world.executeEDL(edl, { path: '/game/main.edl', readFile });
    return { edl, readFile, world };
  };

  it('makes the entities an included file defines', async () => {
    const { world } = await build(
      'entity hall { described { name: "Hall" } script { src: "hall.talk" } }'
    );
    const [hall] = world.queryAll({ with: ['described', 'script'] });

    expect(hall?.described.name).toBe('Hall');
    expect(hall?.script.src).toBe('/game/hall.talk');
  });

  it('counts an EDL changed when a file it includes changes', async () => {
    const { edl, readFile, world } = await build(
      'entity hall { described { name: "Hall" } }'
    );
    const path = '/game/main.edl';

    expect(isEDLChanged(world, edl, { path, readFile })).toBe(false);
    expect(
      isEDLChanged(world, edl, {
        path,
        readFile: files({
          '/game/rooms.edl': 'entity hall { described { name: "Big Hall" } }'
        })
      })
    ).toBe(true);
  });
});

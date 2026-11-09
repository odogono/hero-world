// A Preview World (#243), over Bun's sqlite: built from the main World's
// EDL, or loaded from a subset of a World.
import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get } from 'odgn-ecs/store';

import { worldFiles } from '../../scripts/files';
import { EDL_PATH } from '../files';
import type { MirrorSnapshot } from '../mirror';
import { openPreviewWorld } from '../preview';

const FILES = worldFiles();
const DATABASE = { path: ':memory:', type: DatabaseType.BUN } as const;

const fromEDL = () =>
  openPreviewWorld({
    clock: () => 0,
    database: DATABASE,
    files: FILES,
    source: { edl: FILES[EDL_PATH]! }
  });

const eidOf = (preview: Awaited<ReturnType<typeof fromEDL>>, name: string) =>
  preview.entities().find(e => e.label === name)!.eid;

describe('a Preview World built from EDL', () => {
  test('runs take and open, and reports what each changed', async () => {
    const preview = await fromEDL();
    expect(preview.runs()).toBe(true);
    const mailbox = eidOf(preview, 'mailbox');

    const opened = await preview.command('open mailbox');
    expect(opened.ok).toBe(true);
    expect(opened.lines.join('\n')).toMatch(/open/i);
    expect(opened.changes).toContainEqual([
      mailbox,
      'container',
      'changed',
      expect.objectContaining({ is_closed: false })
    ]);

    const leaflet = eidOf(preview, 'leaflet');
    const taken = await preview.command('take leaflet');
    expect(taken.lines).toContain('Taken.');
    expect(taken.changes).toContainEqual([
      leaflet,
      'location',
      'changed',
      { in: preview.author }
    ]);
    preview.close();
  });

  test('reset puts it back to what it was built from', async () => {
    const preview = await fromEDL();
    const mailbox = eidOf(preview, 'mailbox');
    await preview.command('open mailbox');
    expect(get(preview.store, mailbox, 'container')?.is_closed).toBe(false);

    await preview.reset();
    expect(get(preview.store, mailbox, 'container')?.is_closed).toBe(true);
    preview.close();
  });

  test('describes its Component Definitions and an entity', async () => {
    const preview = await fromEDL();
    const portal = preview.definitions().find(d => d.name === 'portal')!;
    expect(portal.columns).toContainEqual({
      default: null,
      name: 'to',
      type: 'eid'
    });
    expect(portal.buildable).toBe(false);
    const container = preview.definitions().find(d => d.name === 'container')!;
    expect(container.buildable).toBe(true);
    expect(container.columns).toContainEqual({
      default: 10,
      name: 'capacity',
      type: 'float'
    });
    const mailbox = preview.entity(eidOf(preview, 'mailbox'));
    expect(mailbox.described?.name).toBe('Mailbox');
    preview.close();
  });
});

describe('a Preview World loaded from a subset', () => {
  const subset: MirrorSnapshot = {
    character: 2,
    components: {
      described: [{ description: 'A room.', eid: 1, name: 'Room' }],
      location: [{ eid: 2, in: 1 }],
      player: [{ eid: 2, name: 'Ada' }]
    },
    place: 1
  };

  const fromSubset = () =>
    openPreviewWorld({ database: DATABASE, files: FILES, source: { subset } });

  test('holds only that subset, with its eids', async () => {
    const preview = await fromSubset();
    expect(preview.entities()).toEqual([
      { eid: 1, label: 'Room' },
      { eid: 2, label: 'Ada' }
    ]);
    preview.close();
  });

  test('is only to inspect', async () => {
    const preview = await fromSubset();
    expect(preview.runs()).toBe(false);
    expect(await preview.command('look')).toMatchObject({
      ok: false,
      reason: 'inspect_only'
    });
    preview.close();
  });
});

describe('migrating a Preview World', () => {
  const MAIN = FILES[EDL_PATH]!;

  test('applies edited EDL, keeps play state, and reports the plan and changes', async () => {
    const preview = await fromEDL();
    expect(preview.edl).toBe(MAIN);
    const mailbox = eidOf(preview, 'mailbox');
    // play state the Migration must keep
    await preview.command('open mailbox');
    expect((await preview.command('take leaflet')).lines).toContain('Taken.');
    const leaflet = eidOf(preview, 'leaflet');

    const edited = MAIN.replace(
      'A small mailbox on a wooden post.',
      'A dented mailbox, painted green.'
    );
    expect(edited).not.toBe(MAIN);
    const migrated = await preview.migrate(edited);
    if (!migrated.ok) {
      throw new Error(migrated.reason);
    }
    expect(migrated.plan.updated).toContainEqual(
      expect.objectContaining({ changed: ['described'], eid: mailbox })
    );
    expect(migrated.changes).toContainEqual([
      mailbox,
      'described',
      'changed',
      expect.objectContaining({
        description: 'A dented mailbox, painted green.'
      })
    ]);
    expect(get(preview.store, leaflet, 'location')).toEqual({
      in: preview.author
    });
    expect(preview.edl).toBe(edited);
    expect(get(preview.store, mailbox, 'container')?.is_closed).toBe(false);

    // and it still plays
    const looked = await preview.command('examine mailbox');
    expect(looked.lines.join('\n')).toContain('dented');
    preview.close();
  });

  test('a Migration that fails changes nothing', async () => {
    const preview = await fromEDL();
    const before = preview.entities();
    const failed = await preview.migrate('entity broken { nope');
    expect(failed.ok).toBe(false);
    expect(preview.entities()).toEqual(before);
    expect(preview.edl).toBe(MAIN);
    expect((await preview.command('open mailbox')).ok).toBe(true);
    preview.close();
  });
});

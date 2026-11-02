#!/usr/bin/env bun
// Brings a world kept in a file up to date with a changed EDL (ADR 0005).
//
//   bun run world:migrate [--dry-run] [--prune] [--adopt <first.edl>]
//                         [--db <world.db>] [--edl <main.edl>]
//
// --dry-run   migrate a copy, print what would change, leave the file alone
// --prune     move entities gone from the EDL to Limbo (else only listed)
// --adopt     for a world made before Definition names were saved: the EDL
//             it was first built with, e.g. from `git show <rev>:<path>`
/* eslint-disable no-console -- a command-line tool, it prints its report */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { DatabaseType } from 'odgn-ecs/db';
import { adoptDefinitionNames, isEDLChanged } from 'odgn-ecs/edl';
import { createWorld } from 'odgn-ecs/world';

import { defs } from './mua-world/coms';
import { migrateWorld, type WorldMigration } from './mua-world/world/migrate';

const line = (label: string, items: string[]) => {
  if (items.length > 0) {
    console.log(`${label}: ${items.join(', ')}`);
  }
};

const report = ({ exitsRemade, plan, timersCancelled }: WorldMigration) => {
  line('Created', plan.created);
  line(
    'Renamed',
    plan.renamed.map(({ eid, from, to }) => `${from} -> ${to} (#${eid})`)
  );
  for (const { added, changed, eid, lineage, name, removed } of plan.updated) {
    const parts = [
      added.length > 0 && `adds ${added.join(' ')}`,
      changed.length > 0 && `sets ${changed.join(' ')}`,
      removed.length > 0 && `removes ${removed.join(' ')}`,
      lineage && `bases ${lineage.from.join(' ')} -> ${lineage.to.join(' ')}`
    ].filter(Boolean);
    console.log(`Updated ${name} (#${eid}): ${parts.join('; ')}`);
  }
  line(
    plan.pruned ? 'Moved to Limbo' : 'Gone from the EDL (pass --prune)',
    plan.gone.map(({ eid, name }) => `${name} (#${eid})`)
  );
  line(
    'Deleted in play, not brought back',
    plan.missing.map(({ name }) => name)
  );
  line(
    'Changed in play, so the EDL edit is not applied',
    plan.kept.map(
      ({ components, eid, name }) => `${name} (#${eid}) ${components.join(' ')}`
    )
  );
  line('Atoms added', plan.atoms.added);
  line('Atoms with new bases', plan.atoms.changed);
  line('Atoms removed', plan.atoms.removed);
  line(
    'Exits made again for',
    exitsRemade.map(id => `#${id}`)
  );
  line(
    'Timers cancelled',
    timersCancelled.map(({ message, owner }) => `${message} on #${owner}`)
  );
};

const { values } = parseArgs({
  options: {
    adopt: { type: 'string' },
    db: { default: process.env.MUA_DB ?? 'data/world.db', type: 'string' },
    'dry-run': { default: false, type: 'boolean' },
    edl: { default: 'src/server/mua-world/edl/main.edl', type: 'string' },
    prune: { default: false, type: 'boolean' }
  }
});

const dryRun = values['dry-run'];
if (!existsSync(values.db)) {
  console.error(`No world at ${values.db}; the server builds a new one.`);
  process.exit(1);
}

// a dry run migrates a copy, so it reports exactly what a real one would do
const tmp = dryRun ? mkdtempSync(join(tmpdir(), 'mua-migrate-')) : undefined;
const path = tmp ? join(tmp, 'world.db') : values.db;
if (tmp) {
  copyFileSync(values.db, path);
}

const world = await createWorld(defs, { path, type: DatabaseType.BUN });
try {
  const edl = await Bun.file(values.edl).text();

  if (values.adopt) {
    const adopted = adoptDefinitionNames(
      world,
      await Bun.file(values.adopt).text()
    );
    console.log(`Adopted ${adopted.size} Definition names`);
  } else if (world.getDefinitionNames().size === 0) {
    console.error(
      'This world was made before Definition names were saved. Pass --adopt with the EDL it was first built with.'
    );
    process.exit(1);
  }

  if (!isEDLChanged(world, edl)) {
    console.log('The world is up to date with its EDL.');
  } else {
    const result = migrateWorld(world, edl, {
      path: values.edl,
      prune: values.prune
    });
    report(result);
    console.log(
      dryRun ? '\nDry run: nothing was changed.' : `\nMigrated ${values.db}.`
    );
  }
} finally {
  await world.close();
  if (tmp) {
    rmSync(tmp, { force: true, recursive: true });
  }
}

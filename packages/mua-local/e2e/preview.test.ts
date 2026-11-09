// A Preview World's Worker in a real browser (#243): built from the main
// World's EDL in sqlite-wasm, it runs commands, reports their changes and
// resets; loaded from a subset, it only holds that subset.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

import { bundleWorker } from '../scripts/bundle';

const ROOT = resolve(import.meta.dir, '..');
const OUT = mkdtempSync(join(tmpdir(), 'mua-preview-e2e-'));

let server: ReturnType<typeof Bun.serve>;
let browser: Browser;

beforeAll(async () => {
  await bundleWorker(OUT, true);
  server = Bun.serve({
    fetch: req => {
      const path = new URL(req.url).pathname;
      const file =
        path === '/'
          ? Bun.file(join(ROOT, 'e2e/page.html'))
          : Bun.file(join(OUT, path));
      return new Response(file);
    },
    port: 0
  });
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

type Message = { event: string } & Record<string, unknown>;

const heard = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { heard: Message[] }).heard);

const post = (page: Page, message: unknown) =>
  page.evaluate(
    m => (globalThis as unknown as { post: (m: unknown) => void }).post(m),
    message
  );

/** Waits for the `n`th message the page hears, counting from 1 */
const nth = async (page: Page, n: number) => {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const messages = await heard(page);
    const error = messages.find(m => m.event === 'error');
    if (error) {
      throw new Error(`the Worker failed: ${String(error.message)}`);
    }
    if (messages.length >= n) {
      return messages[n - 1]!;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out; heard ${JSON.stringify(messages)}`);
    }
    await Bun.sleep(100);
  }
};

const open = async () => {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.port}/?worker=preview.js`);
  return page;
};

type Entity = { eid: number; label: string };
const eidOf = (m: Message, label: string) =>
  (m.entities as Entity[]).find(e => e.label === label)!.eid;

test('runs commands in a Preview World, reports their changes, and resets', async () => {
  const page = await open();
  await post(page, { type: 'open' });
  const opened = await nth(page, 1);
  expect(opened.event).toBe('opened');
  expect(opened.runs).toBe(true);
  const mailbox = eidOf(opened, 'mailbox');

  await post(page, { ref: 1, text: 'open mailbox', type: 'command' });
  const result = await nth(page, 2);
  expect(result).toMatchObject({ event: 'result', ok: true, ref: 1 });
  expect(result.changes).toContainEqual([
    mailbox,
    'container',
    'changed',
    expect.objectContaining({ is_closed: false })
  ]);

  await post(page, { type: 'reset' });
  expect((await nth(page, 3)).event).toBe('opened');
  await post(page, { eid: mailbox, type: 'entity' });
  const entity = await nth(page, 4);
  expect(
    (entity.components as Record<string, Record<string, unknown>>).container
  ).toMatchObject({ is_closed: true });
  await page.close();
}, 60_000);

test('holds only a subset it is loaded from', async () => {
  const page = await open();
  await post(page, {
    source: {
      subset: {
        character: 2,
        components: {
          described: [{ description: 'A room.', eid: 1, name: 'Room' }],
          player: [{ eid: 2, name: 'Ada' }]
        },
        place: 1
      }
    },
    type: 'open'
  });
  const opened = await nth(page, 1);
  expect(opened).toMatchObject({
    entities: [
      { eid: 1, label: 'Room' },
      { eid: 2, label: 'Ada' }
    ],
    runs: false
  });
  await page.close();
}, 60_000);

test('migrates a Preview World to edited EDL, and reports the plan', async () => {
  const page = await open();
  await post(page, { type: 'open' });
  const opened = await nth(page, 1);
  const edl = String(opened.edl);
  const mailbox = eidOf(opened, 'mailbox');

  await post(page, {
    edl: edl.replace(
      'A small mailbox on a wooden post.',
      'A dented green mailbox.'
    ),
    type: 'migrate'
  });
  const migrated = await nth(page, 2);
  expect(migrated).toMatchObject({ event: 'migrated', ok: true });
  expect(migrated.changes).toContainEqual([
    mailbox,
    'described',
    'changed',
    expect.objectContaining({ description: 'A dented green mailbox.' })
  ]);
  await page.close();
}, 60_000);

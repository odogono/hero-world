// The Local World's Worker in a real browser (ADR 0023): sqlite-wasm in OPFS,
// NorthTalk and the mua Host, driven by the Channel's messages. A reload
// plays on from the World the Worker saved.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

import { bundleWorker } from '../scripts/bundle';

const ROOT = resolve(import.meta.dir, '..');
const OUT = mkdtempSync(join(tmpdir(), 'mua-local-e2e-'));

let server: ReturnType<typeof Bun.serve>;
let browser: Browser;

beforeAll(async () => {
  await bundleWorker(OUT, true);
  // sqlite-wasm's OPFS needs SharedArrayBuffer, so a cross-origin isolated page
  const headers = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
  server = Bun.serve({
    fetch: req => {
      const path = new URL(req.url).pathname;
      const file =
        path === '/'
          ? Bun.file(join(ROOT, 'e2e/page.html'))
          : Bun.file(join(OUT, path));
      return new Response(file, { headers });
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

/** Waits until the page has heard a message matching `test` */
const until = async (page: Page, check: (m: Message[]) => boolean) => {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const messages = await heard(page);
    const error = messages.find(m => m.event === 'error');
    if (error) {
      throw new Error(`the Worker failed: ${String(error.message)}`);
    }
    if (check(messages)) {
      return messages;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out; heard ${JSON.stringify(messages)}`);
    }
    await Bun.sleep(100);
  }
};

const lines = (messages: Message[]) =>
  messages.flatMap(m => (m.event === 'output' ? (m.lines as string[]) : []));

test('plays a Local World in a Worker, and a reload plays on', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.url.href);

  await post(page, { name: 'Ada', type: 'join' });
  let messages = await until(page, m => m.some(x => x.event === 'state'));
  expect(lines(messages)[0]).toContain('Welcome, Ada!');

  await post(page, { ref: 1, text: 'north', type: 'command' });
  messages = await until(page, m => m.some(x => x.event === 'reply'));
  expect(lines(messages).join('\n')).toContain('The Square');
  expect(messages.find(m => m.event === 'reply')).toEqual({
    event: 'reply',
    ok: true,
    ref: 1
  });

  // the same origin, so the same OPFS: the World and Character carry on
  await page.reload();
  await post(page, { name: 'Ada', type: 'join' });
  messages = await until(page, m => m.some(x => x.event === 'state'));
  const state = messages.find(m => m.event === 'state') as unknown as {
    state: { room: { name: string } };
  };
  expect(state.state.room.name).toBe('The Square');
  await context.close();
}, 120_000);

test('saves a World as a file, and another browser loads it and plays on', async () => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto(server.url.href);
  await post(page, { name: 'Ada', type: 'join' });
  await until(page, m => m.some(x => x.event === 'state'));
  await post(page, { ref: 1, text: 'north', type: 'command' });
  await until(page, m => m.some(x => x.event === 'reply'));
  await post(page, { type: 'save' });
  await until(page, m => m.some(x => x.event === 'saved'));
  const save = await page.evaluate(() => {
    const heard = (
      globalThis as unknown as {
        heard: { bytes?: Uint8Array; event: string }[];
      }
    ).heard;
    return [...heard.find(m => m.event === 'saved')!.bytes!];
  });
  await first.close();

  // a fresh browser has its own OPFS, and so its own World
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto(server.url.href);
  await post(other, { name: 'Bob', type: 'join' });
  await until(other, m => m.some(x => x.event === 'state'));
  await other.evaluate(
    bytes =>
      (globalThis as unknown as { post: (m: unknown) => void }).post({
        bytes: new Uint8Array(bytes),
        type: 'load'
      }),
    save
  );
  await until(other, m => m.some(x => x.event === 'loaded'));
  await other.evaluate(() => {
    (globalThis as unknown as { heard: unknown[] }).heard.length = 0;
  });
  await post(other, { name: 'Bob', type: 'join' });
  const messages = await until(other, m => m.some(x => x.event === 'state'));
  const state = messages.find(m => m.event === 'state') as unknown as {
    state: { room: { name: string } };
  };
  expect(state.state.room.name).toBe('The Square');
  await second.close();
}, 120_000);

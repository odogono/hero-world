/// <reference lib="dom" />
// The arcade page in a real browser: the World runs in its Worker on
// sqlite-wasm, and Three.js draws it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';

import { bundle } from '../scripts/bundle';

const OUT = mkdtempSync(join(tmpdir(), 'arcade-e2e-'));

let server: ReturnType<typeof Bun.serve>;
let browser: Browser;

beforeAll(async () => {
  await bundle(OUT, true);
  const headers = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
  server = Bun.serve({
    fetch: req => {
      const path = new URL(req.url).pathname;
      const file = Bun.file(join(OUT, path === '/' ? 'index.html' : path));
      return new Response(file, { headers });
    },
    port: 0
  });
  browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

const hudNumber = (hud: string, label: string) =>
  Number(new RegExp(String.raw`${label} (\d+)`).exec(hud)?.[1] ?? Number.NaN);

test('the World runs in its Worker and the ship shoots asteroids', async () => {
  const page = await browser.newPage({
    viewport: { height: 720, width: 1280 }
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(server.url.href);
  await page.waitForFunction(
    () => /\d+ asteroids/.test(document.querySelector('#hud')!.textContent!),
    undefined,
    { timeout: 30_000 }
  );

  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(
    () => /score [1-9]/.test(document.querySelector('#hud')!.textContent!),
    undefined,
    { timeout: 30_000 }
  );
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Space');

  const hud = (await page.textContent('#hud'))!;
  expect(hudNumber(hud, 'score')).toBeGreaterThan(0);
  expect(hudNumber(hud, 'wave')).toBeGreaterThanOrEqual(1);
  expect(await page.textContent('#banner')).toBe('');
  expect(errors).toEqual([]);

  if (process.env.ARCADE_SCREENSHOT) {
    await page.screenshot({ path: process.env.ARCADE_SCREENSHOT });
  }
}, 90_000);

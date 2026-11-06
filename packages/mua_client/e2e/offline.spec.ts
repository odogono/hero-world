import { expect, test } from '@playwright/test';

import { play, transcript } from './helpers';

// Playing offline (ADR 0023): the main World runs in a Web Worker in this
// browser, with no sign-in, and a reload plays on where it left off.

// A Local World can take ~20s to start (sqlite-wasm and NorthTalk) on a
// slower CI machine, such as the Woodpecker agent on taito
const starting = { timeout: 30_000 };

test('plays a Local World offline, and a reload plays on', async ({
  browser
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  // the page is cross-origin isolated, as sqlite-wasm's OPFS needs
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.getByRole('button', { name: 'Play offline' }).click();
  await page.getByLabel('Name').fill('Ada');
  await page.getByRole('button', { name: 'Enter the world' }).click();
  await expect(transcript(page)).toContainText('Welcome, Ada!', starting);
  await expect(page.getByRole('status')).toHaveText('Connected', starting);

  await play(page, 'north');
  await expect(transcript(page)).toContainText('North of house');

  // the same browser keeps the World and its Character
  await page.reload();
  await page.getByRole('button', { name: 'Play offline' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected', starting);
  await play(page, 'look');
  await expect(transcript(page)).toContainText('North of house');

  await context.close();
});

test('saves a Local World as a file, and another browser loads it', async ({
  browser
}) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Play offline' }).click();
  await page.getByLabel('Name').fill('Ada');
  await page.getByRole('button', { name: 'Enter the world' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected', starting);
  await play(page, 'north');
  await expect(transcript(page)).toContainText('North of house');

  await page.getByRole('button', { name: /profile menu/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Save world' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('mua-world.db');
  // a closed browser deletes its downloads, so keep the save first
  const save = test.info().outputPath('mua-world.db');
  await download.saveAs(save);
  await first.close();

  // a fresh browser plays a World of its own, then loads Ada's
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Play offline' }).click();
  await other.getByLabel('Name').fill('Bob');
  await other.getByRole('button', { name: 'Enter the world' }).click();
  await expect(other.getByRole('status')).toHaveText('Connected', starting);

  await other.getByRole('button', { name: /profile menu/ }).click();
  await other.getByLabel('Saved world file').setInputFiles(save);
  await expect(transcript(other)).toContainText(
    'Loaded a saved world.',
    starting
  );
  await expect(other.getByRole('status')).toHaveText('Connected', starting);
  await play(other, 'look');
  await expect(transcript(other)).toContainText('North of house');
  await second.close();
});

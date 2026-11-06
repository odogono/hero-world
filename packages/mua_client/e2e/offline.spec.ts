import { expect, test } from '@playwright/test';

import { play, transcript } from './helpers';

// Playing offline (ADR 0023): the main World runs in a Web Worker in this
// browser, with no sign-in, and a reload plays on where it left off.

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
  await expect(transcript(page)).toContainText('Welcome, Ada!');
  await expect(page.getByRole('status')).toHaveText('Connected');

  await play(page, 'north');
  await expect(transcript(page)).toContainText('North of house');

  // the same browser keeps the World and its Character
  await page.reload();
  await page.getByRole('button', { name: 'Play offline' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected');
  await play(page, 'look');
  await expect(transcript(page)).toContainText('North of house');

  await context.close();
});

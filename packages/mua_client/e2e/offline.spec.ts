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
  await expect(transcript(page)).toContainText('The Square');

  // the same browser keeps the World and its Character
  await page.reload();
  await page.getByRole('button', { name: 'Play offline' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected', starting);
  await play(page, 'look');
  await expect(transcript(page)).toContainText('The Square');

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
  await expect(transcript(page)).toContainText('The Square');

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
  await expect(transcript(other)).toContainText('The Square');
  await second.close();
});

// Building in a Local World (#265, #293): its Account builds from the start,
// with no Admin, and Try it starts from the Local World's Snapshot
test('a builder composes, tries, places, edits, stores and destroys a satchel offline', async ({
  browser
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Play offline' }).click();
  await page.getByLabel('Name').fill('Ada');
  await page.getByRole('button', { name: 'Enter the world' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected', starting);

  await page.getByRole('button', { exact: true, name: 'Compose' }).click();
  const builder = page.getByRole('complementary', { name: 'Composer' });
  await expect(builder.getByText(/0 of 50 placed/)).toBeVisible();

  // compose, without code
  await builder.getByLabel('Name').fill('Satchel');
  await builder
    .getByLabel('Description', { exact: false })
    .last()
    .fill('A leather satchel.');
  for (const component of ['Item', 'Container']) {
    await builder.getByRole('button', { name: /Add a component/ }).click();
    await builder
      .getByRole('button', { name: new RegExp(`^${component}`) })
      .click();
  }
  await builder.getByLabel('Starts closed').check();

  // try it: a Preview World of where Ada stands, which the Local World
  // never sees
  await builder.getByRole('tab', { name: 'Try it' }).click();
  await builder.getByRole('button', { name: 'take satchel' }).click();
  const tried = builder.getByLabel('Try it transcript');
  await expect(tried).toContainText('Taken.', starting);
  await builder.getByRole('button', { name: 'open satchel' }).click();
  await expect(tried).toContainText('Opened.');

  // place it
  await builder.getByRole('tab', { name: 'Compose' }).click();
  await builder.getByRole('button', { name: /Place here/ }).click();
  await builder.getByRole('button', { name: 'Place it' }).click();
  await expect(builder.getByText('Placed the satchel here.')).toBeVisible();
  await expect(transcript(page)).toContainText('You make the satchel.');

  // edit it from the line that made it
  await builder.getByRole('button', { name: 'Back to play' }).click();
  await transcript(page)
    .getByRole('button', { name: 'edit the satchel' })
    .click();
  await expect(
    builder.getByRole('heading', { name: 'Editing the satchel' })
  ).toBeVisible();
  // its fields come once the Preview World it is tried in has opened
  await expect(builder.getByLabel('Holds up to')).toBeVisible(starting);
  await builder
    .getByLabel('Description', { exact: false })
    .last()
    .fill('A battered satchel.');
  await builder.getByRole('button', { name: 'Save' }).click();
  await expect(builder).toHaveCount(0);
  await expect(transcript(page)).toContainText('You reshape the satchel.');
  await play(page, 'examine satchel');
  await expect(transcript(page)).toContainText('A battered satchel.');

  // store it, and bring it back
  await play(page, 'edit satchel');
  await builder.getByRole('button', { exact: true, name: 'Store' }).click();
  await expect(builder).toHaveCount(0);
  await expect(transcript(page)).toContainText('You put away the satchel.');
  await play(page, 'unstore satchel');
  await expect(transcript(page)).toContainText('You bring out the satchel.');

  // destroy it, for good
  await play(page, 'edit satchel');
  await builder.getByRole('button', { exact: true, name: 'Destroy' }).click();
  await builder.getByRole('button', { name: 'Destroy it' }).click();
  await expect(builder).toHaveCount(0);
  await expect(transcript(page)).toContainText('You unmake the satchel.');
  await page.getByRole('button', { exact: true, name: 'Compose' }).click();
  await expect(builder.getByText(/0 of 50 placed/)).toBeVisible();

  await context.close();
});

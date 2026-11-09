import { expect, test } from '@playwright/test';

import { enter, leaveAll } from './helpers';

// The Admin Preview World (#243): the main World's EDL built in a Worker,
// commands and their changes, and the component inspector.

test.afterEach(leaveAll);

test('an admin previews the World, runs a command and inspects what changed', async ({
  browser
}) => {
  const errors: string[] = [];
  const ada = await enter(browser, 'ada@example.com', 'Ada', page =>
    page.on('pageerror', error => errors.push(error.message))
  );

  await ada.getByRole('button', { name: /profile/i }).click();
  await ada.getByRole('menuitem', { name: 'Preview World' }).click();
  await expect(
    ada.getByRole('heading', { name: 'Preview World' })
  ).toBeVisible();

  const input = ada.getByLabel('Preview command');
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill('open mailbox');
  await input.press('Enter');
  const changes = ada.getByRole('list', { name: 'Changes' });
  await expect(changes).toContainText('container');

  await changes.getByRole('button', { name: 'mailbox' }).click();
  const card = ada.getByRole('article', { name: 'container' });
  await expect(card).toContainText('false');
  // a Reference opens the entity it names
  await ada
    .getByRole('article', { name: 'location' })
    .getByRole('button')
    .click();
  await expect(
    ada.getByRole('region', { name: /west_of_house/ })
  ).toBeVisible();

  await ada.getByRole('button', { name: 'Reset' }).click();
  await expect(changes).toHaveCount(0);

  await ada.getByRole('button', { name: 'Back to play' }).click();
  await expect(ada.getByLabel('Transcript')).toBeVisible();
  expect(errors).toEqual([]);
});

test("someone who isn't an admin has no Preview World", async ({ browser }) => {
  const bob = await enter(browser, 'bob@example.com', 'Bob');
  await bob.getByRole('button', { name: /profile/i }).click();
  await expect(
    bob.getByRole('menuitem', { name: 'Preview World' })
  ).toHaveCount(0);
});

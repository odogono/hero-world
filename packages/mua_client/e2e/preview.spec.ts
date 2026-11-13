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
    ada.getByRole('heading', { name: 'World editor' })
  ).toBeVisible();

  const input = ada.getByLabel('Preview command');
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill('open crate');
  await input.press('Enter');
  const changes = ada.getByRole('list', { name: 'Changes' });
  await expect(changes).toContainText('container');

  await changes.getByRole('button', { name: 'crate' }).click();
  const card = ada.getByRole('article', { name: 'container' });
  await expect(card).toContainText('false');
  // a Reference opens the entity it names
  await ada
    .getByRole('article', { name: 'location' })
    .getByRole('button')
    .click();
  await expect(
    ada.getByRole('region', { name: /harbour_steps/ })
  ).toBeVisible();

  // edit the EDL, and migrate the preview to it: the crate stays open. The
  // editor holds main.edl, which includes the districts, so add a buoy.
  const edl = ada.getByLabel('EDL text');
  const text = await edl.inputValue();
  expect(text).toContain('include "quay.edl"');
  await edl.fill(`${text}
entity buoy : item {
  described { name: "Buoy" description: "A dented green buoy." }
  location { in: $harbour_steps }
}
`);
  await ada.getByRole('button', { name: 'Migrate' }).click();
  const migrationPlan = ada.getByLabel('Migration plan');
  await expect(migrationPlan).toContainText('Created');
  await expect(migrationPlan).toContainText('Kept play state');
  await input.fill('examine buoy');
  await input.press('Enter');
  await expect(ada.getByLabel('Preview transcript')).toContainText(
    'A dented green buoy.'
  );
  await input.fill('examine crate');
  await input.press('Enter');
  await expect(ada.getByLabel('Preview transcript')).toContainText(
    'It contains: the tide card.'
  );
  await ada.screenshot({
    fullPage: true,
    path: process.env.EDITOR_SHOT ?? 'test-results/editor.png'
  });

  // Build starts afresh from the edited EDL
  await ada.getByRole('button', { name: 'Build' }).click();
  await expect(ada.getByLabel('Preview transcript')).toContainText(
    'Built a fresh World'
  );

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

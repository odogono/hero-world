import { expect, test } from '@playwright/test';

import { enter, leaveAll, play, transcript } from './helpers';

// Building (#149): an Admin makes Ada a Builder; she composes a satchel from
// cards, tries it out, and places it; Bob takes it and opens it.

test.afterEach(leaveAll);

test('a builder composes, tries and places a satchel; another player uses it', async ({
  browser
}) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');
  const bob = await enter(browser, 'bob@example.com', 'Bob');

  // no Build button until the Account is a Builder
  await expect(bob.getByRole('button', { name: 'Build' })).toHaveCount(0);
  await play(
    ada,
    ';change the account of the player of actor, "builder", {max_placed: 50}'
  );
  await expect(transcript(ada)).toContainText('=> nothing');
  // a Builder's limits come with joining
  await ada.reload();
  await expect(ada.getByRole('status')).toHaveText('Connected');

  await ada.getByRole('button', { name: 'Build' }).click();
  const builder = ada.getByRole('complementary', { name: 'Builder' });
  await expect(builder.getByText(/of 50 placed/)).toBeVisible();

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
  await expect(builder.getByText('Can be carried')).toBeVisible();

  // try it: a private copy of the plaza, which the World never sees
  await builder.getByRole('tab', { name: 'Try it' }).click();
  await builder.getByRole('button', { name: 'take satchel' }).click();
  const tried = builder.getByLabel('Try it transcript');
  await expect(tried).toContainText('Taken.');
  await expect(tried).toContainText('your satchel');
  await builder.getByRole('button', { name: 'open satchel' }).click();
  await expect(tried).toContainText('Opened.');
  await expect(transcript(bob)).not.toContainText('satchel');

  // place it
  await builder.getByRole('tab', { name: 'Compose' }).click();
  await builder.getByRole('button', { name: /Place here/ }).click();
  await builder.getByRole('button', { name: 'Place it' }).click();
  await expect(builder.getByText('Placed the satchel here.')).toBeVisible();
  await expect(transcript(ada)).toContainText('You make the satchel.');
  await expect(transcript(bob)).toContainText('Ada makes the satchel.');

  // Bob takes it and opens it
  await play(bob, 'take satchel');
  await expect(transcript(bob)).toContainText('Taken.');
  await play(bob, 'open satchel');
  await expect(transcript(bob)).toContainText('Opened.');

  // the plaza is shared with the other checks, which expect Bob empty-handed
  await play(bob, 'drop satchel');
  await expect(transcript(bob)).toContainText('Dropped.');
});

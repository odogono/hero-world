import { expect, test } from '@playwright/test';

import { enter, leaveAll, play, transcript } from './helpers';

// Building (#149): an Admin makes Ada a Builder; she composes a satchel from
// cards, tries it out, and places it; Bob takes it and opens it. Then she
// edits it from the line that made it (#275).

test.afterEach(leaveAll);

test('a builder composes, tries and places a satchel; another player uses it', async ({
  browser
}) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');
  const bob = await enter(browser, 'bob@example.com', 'Bob');

  // no Compose button until the Account is a Builder
  await expect(bob.getByRole('button', { name: 'Compose' })).toHaveCount(0);
  await play(
    ada,
    ';change the account of the player of actor, "builder", {max_placed: 50}'
  );
  await expect(transcript(ada)).toContainText('=> nothing');
  // a Builder's limits come with joining
  await ada.reload();
  await expect(ada.getByRole('status')).toHaveText('Connected');

  await ada.getByRole('button', { exact: true, name: 'Compose' }).click();
  const builder = ada.getByRole('complementary', { name: 'Composer' });
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

  // Ada edits it from the line that made it
  await builder.getByRole('button', { name: 'Back to play' }).click();
  await transcript(ada)
    .getByRole('button', { name: 'edit the satchel' })
    .click();
  await expect(
    builder.getByRole('heading', { name: 'Editing the satchel' })
  ).toBeVisible();

  // the World refuses what the Composer lets through, and the edit stays open
  await builder.getByLabel('Holds up to').fill('25');
  await builder.getByRole('button', { name: 'Save' }).click();
  await expect(builder.getByRole('alert')).toHaveText(
    'Not saved: A container can hold at most 20.'
  );

  await builder.getByLabel('Holds up to').fill('8');
  await builder
    .getByLabel('Description', { exact: false })
    .last()
    .fill('A battered satchel.');

  // Try it holds the one satchel, edited, where the real one is
  await builder.getByRole('tab', { name: 'Try it' }).click();
  await builder.getByLabel('Try a command').fill('examine satchel');
  await builder.getByLabel('Try a command').press('Enter');
  const edited = builder.getByLabel('Try it transcript');
  await expect(edited).toContainText('A battered satchel.');
  await expect(edited).not.toContainText('Which do you mean');

  await builder.getByRole('tab', { name: 'Compose' }).click();
  await builder.getByRole('button', { name: 'Save' }).click();
  await expect(builder).toHaveCount(0);
  await expect(transcript(ada)).toContainText('You reshape the satchel.');
  await expect(transcript(bob)).toContainText('Ada reshapes the satchel.');
  await play(bob, 'examine satchel');
  await expect(transcript(bob)).toContainText('A battered satchel.');
  // its Maker, by their Signature (#276)
  await expect(transcript(bob)).toContainText('Made by Ada.');
});

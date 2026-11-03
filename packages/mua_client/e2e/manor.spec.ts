import { expect, test, type Page } from '@playwright/test';

import { count, enter, leaveAll, play, transcript } from './helpers';

// Scripted interactions in the browser, on the manor World
// (e2e/fixtures/manor.edl): a door, nested containers, choosing between
// two keys, action chips, what each player is told, and a cat that acts
// through the same commands as a player.

test.afterEach(leaveAll);

const chip = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Actions' }).getByRole('button', {
    exact: true,
    name
  });

const choice = (page: Page, name: string) =>
  transcript(page).getByRole('button', { name });

test('a closed door stops you until you open it', async ({ browser }) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');

  await play(ada, 'north');
  await expect(transcript(ada)).toContainText('The oak door is closed.');

  await play(ada, 'open door');
  await expect(transcript(ada)).toContainText('Opened.');
  await play(ada, 'north');
  await expect(transcript(ada)).toContainText('Shelves of dusty books.');
  await play(ada, 'south');
  await expect(transcript(ada)).toContainText('A draughty hall');
});

test('reaches into a box inside a chest', async ({ browser }) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');

  await play(ada, 'look in chest');
  await expect(transcript(ada)).toContainText('It contains: the box.');
  await play(ada, 'open box');
  await expect(transcript(ada)).toContainText(
    'Opening the box reveals: the gem.'
  );
  await play(ada, 'take gem');
  await expect.poll(() => count(ada, 'Taken.')).toBeGreaterThan(0);
  await play(ada, 'drop gem');
  await expect(transcript(ada)).toContainText('Dropped.');
});

test('asks which key, and a stale choice fails safely', async ({ browser }) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');
  const bob = await enter(browser, 'bob@example.com', 'Bob');

  // Ada is asked; Bob takes the brass key before she answers
  await play(ada, 'take key');
  await expect(choice(ada, 'brass key')).toBeVisible();
  await play(bob, 'take brass key');
  await expect(transcript(bob)).toContainText('Taken.');
  await choice(ada, 'brass key').click();
  await expect(transcript(ada)).toContainText('That is no longer here.');

  // with both keys back, a click answers the choice
  await play(bob, 'drop brass key');
  await expect(transcript(bob)).toContainText('Dropped.');
  await play(ada, 'take key');
  await expect(choice(ada, 'iron key')).toBeVisible();
  await choice(ada, 'iron key').click();

  // each is told their own version of the same event
  await expect(transcript(ada)).toContainText('Taken.');
  await expect(transcript(bob)).toContainText('Ada takes the iron key.');
  await play(ada, 'drop iron key');
  await expect(transcript(ada)).toContainText('Dropped.');
});

test('action chips send commands the normal way', async ({ browser }) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');
  await play(ada, 'look');

  await chip(ada, 'east').click();
  await expect(transcript(ada)).toContainText('> east');
  await expect(transcript(ada)).toContainText('It smells of bread.');
  await chip(ada, 'west').click();
  await expect(transcript(ada)).toContainText('> west');
  await expect.poll(() => count(ada, 'A draughty hall')).toBeGreaterThan(1);
});

test('the cat wanders in on its own, and talks to whoever is there', async ({
  browser
}) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');

  // it came from the kitchen whether or not anyone was online
  await expect
    .poll(
      async () => {
        await play(ada, 'look');
        const text = (await transcript(ada).textContent()) ?? '';
        return /Also here: [^\n]*\bcat\b/.test(text);
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  // and speaks through the same command path as a player
  await expect(transcript(ada)).toContainText('cat says, "Meow"', {
    timeout: 10_000
  });
});

test('an admin runs NorthTalk at the prompt; nobody else can', async ({
  browser
}) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');
  const bob = await enter(browser, 'bob@example.com', 'Bob');

  await play(ada, ';return 6 * 7');
  await expect(transcript(ada)).toContainText('=> 42');

  await play(ada, ';return (');
  await expect(transcript(ada)).toContainText('!! line 1:');

  await play(bob, ';return 6 * 7');
  await expect(transcript(bob)).toContainText("You can't do that.");
  expect(await count(bob, '=> 42')).toBe(0);
});

import { expect, test } from '@playwright/test';

import {
  command,
  count,
  enter,
  lastLine,
  leaveAll,
  play,
  transcript
} from './helpers';

// Two players in two browsers, through the first playable milestone
// (docs/mua-next.md): sign in, meet, talk, move, share an item, and recover
// from a dropped Connection.

test.afterEach(leaveAll);

test('two players meet, talk, move and share an item', async ({ browser }) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');
  const bob = await enter(browser, 'bob@example.com', 'Bob');

  // meet
  await play(ada, 'look');
  await expect(transcript(ada)).toContainText('Plaza');
  await expect(transcript(ada)).toContainText('Bob');

  // talk
  await play(ada, 'say hello');
  await expect(transcript(ada)).toContainText('You say, "hello"');
  await expect(transcript(bob)).toContainText('Ada says, "hello"');

  // move
  await play(bob, 'north');
  await expect(transcript(bob)).toContainText('Garden');
  await play(bob, 'south');
  await expect(transcript(bob)).toContainText('Plaza');

  // take and drop
  await play(ada, 'take coin');
  await expect(transcript(ada)).toContainText('Taken.');
  await expect(transcript(bob)).toContainText('Ada takes the coin.');
  await play(ada, 'drop coin');
  await expect(transcript(ada)).toContainText('Dropped.');

  // both reach for the coin at once: exactly one gets it
  const before = (await count(ada, 'Taken.')) + (await count(bob, 'Taken.'));
  await Promise.all([play(ada, 'take coin'), play(bob, 'take coin')]);
  await expect
    .poll(
      async () =>
        (await count(ada, 'Taken.')) + (await count(bob, 'Taken.')) - before
    )
    .toBe(1);
  // and each inventory agrees with what each was told
  const adaHas = (await count(ada, 'Taken.')) > 1;
  const [holder, other] = adaHas ? [ada, bob] : [bob, ada];
  await play(holder, 'inventory');
  await expect(lastLine(holder)).toHaveText('You are carrying: the coin.');
  await play(other, 'inventory');
  await expect(lastLine(other)).toHaveText('You are empty-handed.');
});

test('a dropped Connection marks the gap and sends nothing again', async ({
  browser
}) => {
  const ada = await enter(browser, 'ada@example.com', 'Ada');

  await play(ada, 'look');
  await expect(transcript(ada)).toContainText('Plaza');

  // send a command, then cut the Connection before its reply can be relied on
  await command(ada).fill('inventory');
  await command(ada).press('Enter');
  await ada.evaluate(() => {
    const mua = (
      window as unknown as {
        mua: { socket: () => { conn?: { close: () => void } } | undefined };
      }
    ).mua;
    mua.socket()?.conn?.close();
  });

  await expect(ada.getByRole('separator')).toContainText('connection lost');
  await expect(ada.getByRole('status')).toHaveText('Connected');

  // the command shows once, and was never sent again
  expect(await count(ada, '> inventory')).toBe(1);
  // and play carries on
  await play(ada, 'look');
  await expect.poll(() => count(ada, 'A sunny plaza')).toBe(2);
  expect(await count(ada, '> inventory')).toBe(1);
});

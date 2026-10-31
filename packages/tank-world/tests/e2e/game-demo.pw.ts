import { expect, test } from '@playwright/test';

test('connects, spawns, and receives updates', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  const demo = page.getByTestId('game-demo');
  await expect(demo).toBeVisible();

  // Connect
  await demo.getByTestId('connect-btn').click();
  await expect(demo.getByTestId('status')).toContainText('open', {
    timeout: 20_000
  });

  // Spawn a tank
  await demo.getByTestId('spawn-team').selectOption('red');
  await demo.getByTestId('spawn-x').fill('0');
  await demo.getByTestId('spawn-y').fill('0');
  await demo.getByTestId('spawn-submit').click();

  // Expect to receive world updates
  await expect(demo.getByTestId('last-update')).toContainText('world:update', {
    timeout: 5000
  });
});

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page
} from '@playwright/test';

// What the browser checks share: signing in, typing, and reading the
// transcript

export const transcript = (page: Page) => page.getByLabel('Transcript');
export const command = (page: Page) => page.getByLabel('Command');
export const lastLine = (page: Page) =>
  transcript(page).locator('li.line').last();

export const play = async (page: Page, text: string) => {
  await command(page).fill(text);
  await command(page).press('Enter');
};

const contexts: BrowserContext[] = [];

/** Closes every browser `enter` opened, so no Connection outlives its test */
export const leaveAll = async () => {
  await Promise.all(contexts.splice(0).map(context => context.close()));
};

/**
 * Signs in by email, making the Character if the Account has none.
 * `before` is called with the page before it opens, to watch it.
 */
export const enter = async (
  browser: Browser,
  email: string,
  name: string,
  before?: (page: Page) => void
) => {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  before?.(page);
  await page.goto('/');
  await page.getByLabel(/Email/).fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // an Account that has a Character goes straight to it
  const nameField = page.getByLabel('Name');
  const status = page.getByRole('status');
  await expect(nameField.or(status)).toBeVisible();
  if (await nameField.isVisible()) {
    await nameField.fill(name);
    await page.getByRole('button', { name: 'Enter the world' }).click();
  }
  await expect(status).toHaveText('Connected');
  return page;
};

/** How many times `text` appears in the transcript */
export const count = async (page: Page, text: string) =>
  ((await transcript(page).textContent()) ?? '').split(text).length - 1;

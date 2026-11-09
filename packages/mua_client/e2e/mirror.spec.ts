import { expect, test, type Page } from '@playwright/test';

import { enter, leaveAll, play, transcript } from './helpers';

// The browser's mirror of the server's World (#164): it holds only what the
// Character perceives, and follows each Step.

test.afterEach(leaveAll);

type Frame = { event: string; payload: Record<string, unknown> };

/** The Channel's messages from the server, as they arrive */
const watch = (page: Page, frames: Frame[], errors: string[]) => {
  page.on('websocket', ws =>
    ws.on('framereceived', ({ payload }) => {
      // Phoenix's frames: [join_ref, ref, topic, event, payload]
      const [, , , event, body] = JSON.parse(String(payload)) as unknown[];
      frames.push({ event: String(event), payload: body as Frame['payload'] });
    })
  );
  page.on('console', message => {
    // the session check before signing in is refused, as it should be
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource')
    ) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => errors.push(error.message));
};

const names = (rows: unknown) =>
  ((rows ?? []) as { name?: string }[]).map(r => r.name);

test('the mirror holds what the Character perceives, and follows each Step', async ({
  browser
}) => {
  const frames: Frame[] = [];
  const errors: string[] = [];
  const ada = await enter(browser, 'ada@example.com', 'Ada', page =>
    watch(page, frames, errors)
  );

  await expect.poll(() => frames.some(f => f.event === 'mirror')).toBe(true);
  const mirror = frames.find(f => f.event === 'mirror')!.payload;
  const components = mirror.components as Record<string, unknown>;
  expect(names(components.described)).toContain('Plaza');
  expect(names(components.described)).not.toContain('Garden');
  expect(components.script).toBeUndefined();
  expect(components.account).toBeUndefined();
  await expect.poll(() => ada.workers().length).toBeGreaterThan(0);

  // walking north brings the garden into view and drops the plaza
  await play(ada, 'north');
  await expect(transcript(ada)).toContainText('Garden');
  await expect
    .poll(() =>
      frames
        .filter(f => f.event === 'changes')
        .some(f =>
          names((f.payload.put as Record<string, unknown>).described).includes(
            'Garden'
          )
        )
    )
    .toBe(true);
  await play(ada, 'south');
  await expect(transcript(ada)).toContainText('Plaza');

  expect(errors).toEqual([]);
});

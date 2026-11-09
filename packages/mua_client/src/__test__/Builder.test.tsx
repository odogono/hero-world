import { afterEach, describe, expect, test } from 'bun:test';
import type {
  MirrorSnapshot,
  PreviewDefinition,
  PreviewSource
} from 'mua-local';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/preact';

import { Builder } from '../builder/Builder';
import type { Placed } from '../connection';
import type { PreviewClient } from '../preview/client';

afterEach(cleanup);

const col = (name: string, type: string, value: unknown = null) => ({
  default: value,
  name,
  type
});

const definitions: PreviewDefinition[] = [
  {
    buildable: true,
    columns: [col('description', 'string'), col('name', 'string')],
    name: 'described'
  },
  {
    buildable: true,
    columns: [col('is_takeable', 'boolean', true), col('weight', 'float', 1)],
    name: 'item'
  },
  {
    buildable: true,
    columns: [col('capacity', 'float', 10), col('is_closed', 'boolean', false)],
    name: 'container'
  },
  { buildable: true, columns: [col('words', 'array')], name: 'noun' },
  { buildable: true, columns: [col('text', 'string')], name: 'readable' },
  { buildable: false, columns: [col('in', 'eid')], name: 'location' }
];

const MIRROR: MirrorSnapshot = { character: 11, components: {}, place: 10 };

// the Try it World: the composition is 3, the stand-in 2, the room 1
const reply = () => ({
  definitions,
  entities: [
    { eid: 1, label: 'Hall' },
    { eid: 2, label: 'Ada' },
    { eid: 3, label: 'Satchel' }
  ],
  event: 'opened' as const,
  origins: [
    [1, { eid: 10, kind: 'perceived' }],
    [2, { eid: 11, kind: 'stand-in' }],
    [3, { kind: 'composition' }]
  ] as [number, never][],
  runs: true
});

const fakeClient = () => {
  const opened: PreviewSource[] = [];
  const sent: string[] = [];
  let resets = 0;
  const client: PreviewClient = {
    close: () => {},
    command: text => {
      sent.push(text);
      return Promise.resolve({
        changes:
          text === 'take satchel'
            ? [
                [3, 'location', 'changed', { in: 2 }],
                [2, 'player', 'changed', { last_input: 'take satchel' }]
              ]
            : [],
        entities: reply().entities,
        event: 'result',
        lines: [text === 'go north' ? 'You go north.' : 'Taken.'],
        ok: true,
        outside:
          text === 'go north' ? [{ eid: 9, label: 'Beyond the north' }] : [],
        ref: sent.length
      });
    },
    entity: eid => Promise.resolve({ components: {}, eid, event: 'entity' }),
    migrate: () => Promise.reject(new Error('not here')),
    open: source => {
      opened.push(source!);
      return Promise.resolve(reply());
    },
    reset: () => {
      resets++;
      return Promise.resolve(reply());
    }
  };
  return { client, opened, resets: () => resets, sent };
};

const limits = { max_capacity: 20, max_placed: 50, placed: 3 };

const setup = async (
  place: (c: Record<string, unknown>) => Promise<Placed> = () =>
    Promise.resolve({ eid: 99, ok: true })
) => {
  const fake = fakeClient();
  const placed: Record<string, unknown>[] = [];
  render(
    <Builder
      client={fake.client}
      limits={limits}
      onClose={() => {}}
      place={c => {
        placed.push(c);
        return place(c);
      }}
      snapshot={() => Promise.resolve(MIRROR)}
    />
  );
  // the cards' fields come with the definitions
  await screen.findByLabelText(/Name/);
  return { ...fake, placed };
};

const field = (card: string, label: RegExp) =>
  within(screen.getByRole('region', { name: card })).getByLabelText(label);

const type = (el: HTMLElement, value: string) =>
  fireEvent.input(el, { target: { value } });

const addComponent = async (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: /Add a component/ }));
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(label) })
  );
};

describe('the composer', () => {
  test('composes a satchel from cards, and shows what it can do', async () => {
    await setup();
    expect(screen.getByText('3 of 50 placed')).toBeTruthy();
    type(field('Description', /Name/), 'Satchel');
    expect(screen.getByRole('heading', { name: 'Satchel' })).toBeTruthy();

    await addComponent('Item');
    await addComponent('Container');
    const capacity = field('Container', /Holds up to/) as HTMLInputElement;
    expect(capacity.value).toBe('10');
    expect(screen.getByText('Can be carried')).toBeTruthy();
    expect(screen.getByText('Can hold things')).toBeTruthy();

    // removing a card takes away what it let the thing do
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item' }));
    expect(screen.queryByText('Can be carried')).toBeNull();
    // a thing always has a name
    expect(
      screen.queryByRole('button', { name: 'Remove Description' })
    ).toBeNull();
  });

  test("fills a noun's words from the name until they are edited", async () => {
    await setup();
    await addComponent('Other words');
    type(field('Description', /Name/), 'Canvas Satchel');
    const words = field('Other words', /Words/) as HTMLInputElement;
    expect(words.value).toBe('canvas, satchel');
    type(words, 'bag');
    type(field('Description', /Name/), 'Leather Satchel');
    expect((field('Other words', /Words/) as HTMLInputElement).value).toBe(
      'bag'
    );
  });

  test('holds back Place while the World would refuse it', async () => {
    await setup();
    await screen.findByRole('button', { name: /Add a component/ });
    const place = screen.getByRole('button', {
      name: /Place here/
    }) as HTMLButtonElement;
    expect(place.disabled).toBe(true);
    expect(screen.getByText('It needs a name.')).toBeTruthy();
    type(field('Description', /Name/), 'Satchel');
    await addComponent('Container');
    type(field('Container', /Holds up to/), '25');
    expect(screen.getByText('A container can hold at most 20.')).toBeTruthy();
    expect(place.disabled).toBe(true);
  });

  test('places it after a summary, sending only what has a value', async () => {
    const { placed } = await setup();
    type(field('Description', /Name/), 'Satchel');
    await addComponent('Item');
    fireEvent.click(screen.getByRole('button', { name: /Place here/ }));
    const summary = screen.getByRole('group', { name: 'Place it?' });
    expect(summary.textContent).toContain('Place the satchel in the room');
    fireEvent.click(within(summary).getByRole('button', { name: 'Place it' }));

    await screen.findByText('Placed the satchel here.');
    expect(placed).toEqual([
      { described: { name: 'Satchel' }, item: { is_takeable: true, weight: 1 } }
    ]);
    // ready for the next one
    expect(screen.getByRole('heading', { name: 'Something new' })).toBeTruthy();
  });

  test("shows the World's reason when it refuses", async () => {
    await setup(() =>
      Promise.resolve({ ok: false, reason: "You can't build." })
    );
    type(field('Description', /Name/), 'Satchel');
    await screen.findByRole('button', { name: /Add a component/ });
    fireEvent.click(screen.getByRole('button', { name: /Place here/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Place it' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Not placed: You can't build."
    );
    expect(screen.getByRole('heading', { name: 'Satchel' })).toBeTruthy();
  });
});

const tryIt = async () => {
  const fake = await setup();
  type(field('Description', /Name/), 'Satchel');
  await addComponent('Item');
  fireEvent.click(screen.getByRole('tab', { name: 'Try it' }));
  await screen.findByRole('button', { name: 'take satchel' });
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Try a command') as HTMLInputElement).disabled
    ).toBe(false)
  );
  return fake;
};

describe('Try it', () => {
  test('builds a copy of where you stand with the composition, from the mirror', async () => {
    const { opened } = await tryIt();
    expect(opened.at(-1)).toEqual({
      tryIt: {
        composition: {
          described: { name: 'Satchel' },
          item: { is_takeable: true, weight: 1 }
        },
        mirror: MIRROR
      }
    });
  });

  test('runs a command and says what each change happened to', async () => {
    const { sent } = await tryIt();
    fireEvent.click(screen.getByRole('button', { name: 'take satchel' }));
    const changes = await screen.findByRole('list', { name: 'What changed' });
    expect(sent).toEqual(['take satchel']);
    expect(changes.textContent).toContain('your satchel');
    expect(changes.textContent).toContain('in: you');
    // not the stand-in's own bookkeeping
    expect(changes.textContent).not.toContain('last_input');
  });

  test('says when a command reaches beyond what you can see, and resets', async () => {
    const fake = await tryIt();
    const input = screen.getByLabelText('Try a command');
    type(input, 'go north');
    fireEvent.submit(input.closest('form')!);
    expect(
      await screen.findByText(/reached beyond what you can see/)
    ).toBeTruthy();
    expect(screen.getByText(/Beyond the north/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(fake.resets()).toBe(1));
    await waitFor(() =>
      expect(screen.queryByText(/reached beyond/)).toBeNull()
    );
  });
});

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

import { ComposerPanel } from '../composer/ComposerPanel';
import type { Patch, Placed, PutAway, Saved } from '../connection';
import type { PreviewClient } from '../preview/client';
import type { Editing } from '../store';

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
        lines: [text === 'go north' ? 'You go north.' : 'Taken.'],
        ok: true,
        outside:
          text === 'go north' ? [{ eid: 9, label: 'Beyond the north' }] : []
      });
    },
    entity: eid => Promise.resolve({ components: {}, eid }),
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
    <ComposerPanel
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

describe('the Composer', () => {
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
  // #310: a mirror that can't be read used to leave Try it waiting forever
  test("says why when it can't read where you stand", async () => {
    render(
      <ComposerPanel
        client={fakeClient().client}
        limits={limits}
        onClose={() => {}}
        place={() => Promise.resolve({ eid: 99, ok: true })}
        snapshot={() =>
          Promise.reject(
            new Error(
              "Try it couldn't read where you stand: the Worker stopped. Reconnect to try again."
            )
          )
        }
      />
    );
    expect(
      await screen.findByText(/couldn't read where you stand/)
    ).toBeTruthy();
  });

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

// the satchel Ada placed, as the `compose` message brings it
const SATCHEL: Editing = {
  composition: {
    container: { capacity: 5, is_closed: true },
    described: { description: 'A leather satchel.', name: 'Satchel' },
    item: { is_takeable: true, weight: 1 }
  },
  eid: 42
};

const LAMP: Editing = {
  composition: { described: { description: 'A brass lamp.', name: 'Lamp' } },
  eid: 43
};

const editSetup = async (
  save: (eid: number, patch: Patch) => Promise<Saved> = () =>
    Promise.resolve({ ok: true }),
  putAway: (eid: number, verb: PutAway) => Promise<Saved> = () =>
    Promise.resolve({ ok: true })
) => {
  const fake = fakeClient();
  const putAways: [number, PutAway][] = [];
  const saves: [number, Patch][] = [];
  const declined: (string | undefined)[] = [];
  let saved = 0;
  const panel = (editing: Editing | null) => (
    <ComposerPanel
      client={fake.client}
      editing={editing}
      limits={limits}
      onClose={() => {}}
      onDecline={keeping => declined.push(keeping)}
      onSaved={() => saved++}
      place={() => Promise.resolve({ eid: 99, ok: true })}
      putAway={(eid, verb) => {
        putAways.push([eid, verb]);
        return putAway(eid, verb);
      }}
      save={(eid, patch) => {
        saves.push([eid, patch]);
        return save(eid, patch);
      }}
      snapshot={() => Promise.resolve(MIRROR)}
    />
  );
  const { rerender } = render(panel(SATCHEL));
  await screen.findByLabelText(/Holds up to/);
  return {
    ...fake,
    declined,
    open: (editing: Editing | null) => rerender(panel(editing)),
    putAways,
    saved: () => saved,
    saves
  };
};

describe('editing a placed thing (#275)', () => {
  test('opens it with its name, and Save sends only what changed', async () => {
    const { saved, saves } = await editSetup();
    expect(
      screen.getByRole('heading', { name: 'Editing the satchel' })
    ).toBeTruthy();
    expect(screen.queryByText(/placed$/)).toBeNull();
    const save = screen.getByRole('button', {
      name: 'Save'
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    type(field('Description', /Description/), 'A battered satchel.');
    type(field('Container', /Holds up to/), '8');
    // the heading keeps the name it was opened with
    type(field('Description', /Name/), 'Bag');
    expect(
      screen.getByRole('heading', { name: 'Editing the satchel' })
    ).toBeTruthy();
    fireEvent.click(save);

    await waitFor(() => expect(saved()).toBe(1));
    expect(saves).toEqual([
      [
        42,
        {
          put: {
            container: { capacity: 8 },
            described: { description: 'A battered satchel.', name: 'Bag' }
          },
          remove: []
        }
      ]
    ]);
  });

  test("leaves its capacity to its Maker's limit, which the World checks", async () => {
    await editSetup();
    type(field('Container', /Holds up to/), '25');
    expect(screen.queryByText(/can hold at most/)).toBeNull();
  });

  test("shows the World's reason, and stays open", async () => {
    const { saved } = await editSetup(() =>
      Promise.resolve({
        ok: false,
        reason: "The satchel holds 3 things: it can't hold fewer."
      })
    );
    type(field('Container', /Holds up to/), '1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Not saved: The satchel holds 3 things: it can't hold fewer."
    );
    expect(saved()).toBe(0);
    expect((field('Container', /Holds up to/) as HTMLInputElement).value).toBe(
      '1'
    );
  });

  test('tries the edit in place of the real one', async () => {
    const { opened } = await editSetup();
    fireEvent.click(screen.getByRole('tab', { name: 'Try it' }));
    await waitFor(() =>
      expect(opened.at(-1)).toEqual({
        tryIt: {
          composition: SATCHEL.composition,
          mirror: MIRROR,
          replaces: 42
        }
      })
    );
  });

  test('the same thing sent again keeps the changes', async () => {
    const { open } = await editSetup();
    type(field('Description', /Description/), 'A battered satchel.');
    open({ ...SATCHEL });
    expect(
      (field('Description', /Description/) as HTMLTextAreaElement).value
    ).toBe('A battered satchel.');
    expect(screen.queryByRole('group', { name: /Discard/ })).toBeNull();
  });

  test('another thing replaces an untouched edit at once', async () => {
    const { open } = await editSetup();
    open(LAMP);
    expect(
      await screen.findByRole('heading', { name: 'Editing the lamp' })
    ).toBeTruthy();
  });

  test('asks before another thing replaces unsaved changes', async () => {
    const { declined, open } = await editSetup();
    type(field('Description', /Description/), 'A battered satchel.');
    open(LAMP);
    const ask = await screen.findByRole('group', { name: /Discard/ });
    expect(ask.textContent).toContain(
      'Discard your changes to the satchel to edit the lamp?'
    );
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep them' }));
    expect(declined).toEqual(['Satchel']);
    expect(
      screen.getByRole('heading', { name: 'Editing the satchel' })
    ).toBeTruthy();

    // the World opens the satchel again
    open({ ...SATCHEL });
    open({ ...LAMP, eid: 44 });
    fireEvent.click(
      within(await screen.findByRole('group', { name: /Discard/ })).getByRole(
        'button',
        { name: 'Discard them' }
      )
    );
    expect(
      await screen.findByRole('heading', { name: 'Editing the lamp' })
    ).toBeTruthy();
  });
});

describe('storing and destroying from the Composer (#284)', () => {
  test('Store puts the thing away and closes the Composer', async () => {
    const { putAways, saved } = await editSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Store' }));
    await waitFor(() => expect(saved()).toBe(1));
    expect(putAways).toEqual([[42, 'store']]);
  });

  test('Destroy asks first, and Keep it sends nothing', async () => {
    const { putAways, saved } = await editSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Destroy' }));
    const ask = screen.getByRole('group', { name: 'Destroy it?' });
    expect(ask.textContent).toContain('Destroy the satchel?');
    expect(putAways).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: 'Destroy it?' })).toBeNull();
    expect(putAways).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Destroy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Destroy it' }));
    await waitFor(() => expect(saved()).toBe(1));
    expect(putAways).toEqual([[42, 'destroy']]);
  });

  test("a refused Destroy shows the World's reason, and stays open", async () => {
    const { saved } = await editSetup(undefined, () =>
      Promise.resolve({
        ok: false,
        reason: 'The satchel holds things: empty it first.'
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Destroy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Destroy it' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Not destroyed: The satchel holds things: empty it first.'
    );
    expect(saved()).toBe(0);
    expect(
      screen.getByRole('heading', { name: 'Editing the satchel' })
    ).toBeTruthy();
  });

  test('a new thing has neither', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: 'Store' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Destroy' })).toBeNull();
  });
});

import { afterEach, describe, expect, test } from 'bun:test';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/preact';

import { Inspector } from '../preview/Inspector';
import { Preview } from '../preview/Preview';
import type { PreviewClient } from '../preview/client';

afterEach(cleanup);

const definitions = [
  { columns: [{ name: 'in', type: 'eid' }], name: 'location' },
  {
    columns: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' }
    ],
    name: 'described'
  },
  { columns: [{ name: 'is_closed', type: 'boolean' }], name: 'container' }
];

const entities = [
  { eid: 1, label: 'west_of_house' },
  { eid: 2, label: 'mailbox' }
];

const world: Record<number, Record<string, Record<string, unknown>>> = {
  1: { described: { description: 'An open field.', name: 'West of House' } },
  2: {
    container: { is_closed: true },
    described: { description: 'A small mailbox.', name: 'Mailbox' },
    location: { in: 1 }
  }
};

describe('Inspector', () => {
  test('draws a card per component, and links a Reference', () => {
    const opened: number[] = [];
    render(
      <Inspector
        components={world[2]!}
        definitions={definitions}
        eid={2}
        labelOf={eid => entities.find(e => e.eid === eid)!.label}
        onOpen={eid => opened.push(eid)}
      />
    );
    const card = screen.getByRole('article', { name: 'container' });
    expect(within(card).getByText('is_closed')).toBeTruthy();
    expect(within(card).getByText('true')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /west_of_house/ }));
    expect(opened).toEqual([1]);
  });
});

const EDL = 'entity mailbox { described { description: "A small mailbox." } }';

const plan = {
  atoms: { added: [], changed: [], removed: [] },
  created: [],
  gone: [],
  kept: [{ components: ['container'], eid: 2, name: 'mailbox' }],
  missing: [],
  pruned: false,
  renamed: [],
  updated: [
    { added: [], changed: ['described'], eid: 2, name: 'mailbox', removed: [] }
  ]
};

const fakeClient = () => {
  const sent: string[] = [];
  const built: (string | undefined)[] = [];
  const migrated: string[] = [];
  const client: PreviewClient = {
    close: () => {},
    command: text => {
      sent.push(text);
      world[2]!.container = { is_closed: false };
      return Promise.resolve({
        changes: [[2, 'container', 'changed', { is_closed: false }]],
        entities,
        event: 'result',
        lines: ['Opened.'],
        ok: true,
        ref: sent.length
      });
    },
    entity: eid =>
      Promise.resolve({ components: world[eid]!, eid, event: 'entity' }),
    migrate: edl => {
      migrated.push(edl);
      return Promise.resolve(
        edl.includes('nope')
          ? {
              definitions,
              entities,
              event: 'migrated',
              ok: false,
              reason: 'Unexpected token'
            }
          : {
              changes: [[2, 'described', 'changed', { name: 'Mailbox' }]],
              definitions,
              entities,
              event: 'migrated',
              ok: true,
              plan
            }
      );
    },
    open: source => {
      const edl = source && 'edl' in source ? source.edl : EDL;
      built.push(source && 'edl' in source ? source.edl : undefined);
      return Promise.resolve({
        definitions,
        edl,
        entities,
        event: 'opened',
        runs: true
      });
    },
    reset: () => {
      world[2]!.container = { is_closed: true };
      return Promise.resolve({
        definitions,
        entities,
        event: 'opened',
        runs: true
      });
    }
  };
  return { built, client, migrated, sent };
};

describe('Preview', () => {
  test('runs a command, shows its changes, and inspects what changed', async () => {
    const { client, sent } = fakeClient();
    render(<Preview client={client} onClose={() => {}} />);
    const input = screen.getByLabelText('Preview command') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));

    fireEvent.input(input, { target: { value: 'open mailbox' } });
    fireEvent.submit(input.form!);
    await screen.findByText('Opened.');
    expect(sent).toEqual(['open mailbox']);

    const changes = screen.getByRole('list', { name: 'Changes' });
    fireEvent.click(within(changes).getByRole('button', { name: 'mailbox' }));
    const card = await screen.findByRole('article', { name: 'container' });
    expect(within(card).getByText('false')).toBeTruthy();
  });

  test('reset clears the transcript and reads the World again', async () => {
    const { client } = fakeClient();
    render(<Preview client={client} onClose={() => {}} />);
    const input = screen.getByLabelText('Preview command') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.input(input, { target: { value: 'open mailbox' } });
    fireEvent.submit(input.form!);
    await screen.findByText('Opened.');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.queryByText('Opened.')).toBeNull());
  });
});

const ready = async () => {
  const edl = screen.getByLabelText('EDL text') as HTMLTextAreaElement;
  await waitFor(() => expect(edl.value).toBe(EDL));
  return edl;
};

describe('World editor', () => {
  test("starts from the World's EDL, and migrates only once it is edited", async () => {
    const { client, migrated } = fakeClient();
    render(<Preview client={client} onClose={() => {}} />);
    const edl = await ready();
    const migrate = screen.getByRole('button', {
      name: 'Migrate'
    }) as HTMLButtonElement;
    expect(migrate.disabled).toBe(true);

    fireEvent.input(edl, { target: { value: EDL.replace('small', 'dented') } });
    expect(migrate.disabled).toBe(false);
    fireEvent.click(migrate);

    const planList = await screen.findByLabelText('Migration plan');
    expect(within(planList).getByText('Updated')).toBeTruthy();
    expect(within(planList).getByText('Kept play state')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Changes' })).toBeTruthy();
    expect(migrated).toEqual([EDL.replace('small', 'dented')]);
    await waitFor(() => expect(migrate.disabled).toBe(true));
  });

  test('a Migration that fails says so, and the preview stays as it was', async () => {
    const { client } = fakeClient();
    render(<Preview client={client} onClose={() => {}} />);
    const edl = await ready();
    fireEvent.input(edl, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Migrate' }));
    await screen.findByText(/Not migrated: Unexpected token/);
  });

  test('Build makes a fresh World from the edited EDL', async () => {
    const { built, client } = fakeClient();
    render(<Preview client={client} onClose={() => {}} />);
    const edl = await ready();
    fireEvent.input(edl, { target: { value: EDL.replace('small', 'dented') } });
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    await screen.findByText('Built a fresh World from the EDL.');
    expect(built).toEqual([undefined, EDL.replace('small', 'dented')]);
  });
});

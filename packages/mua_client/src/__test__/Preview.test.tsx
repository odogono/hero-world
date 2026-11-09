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

const fakeClient = () => {
  const sent: string[] = [];
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
    open: () =>
      Promise.resolve({ definitions, entities, event: 'opened', runs: true }),
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
  return { client, sent };
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

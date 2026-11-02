import { afterEach, describe, expect, mock, test } from 'bun:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';

import { NameForm } from '../NameForm';

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const respond = (status: number, body: unknown) => {
  globalThis.fetch = mock(async () =>
    Response.json(body, { status })
  ) as unknown as typeof fetch;
};

const submit = (name: string) => {
  fireEvent.input(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.submit(screen.getByRole('button').closest('form')!);
};

describe('the name form', () => {
  test('makes the Character', async () => {
    respond(201, { id: 7, name: 'Ada' });
    let created = false;
    render(<NameForm onCreated={() => (created = true)} />);

    submit('Ada');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(created).toBe(true);
  });

  test('says why a name was refused', async () => {
    respond(422, { error: 'name_taken' });
    render(<NameForm onCreated={() => {}} />);

    submit('Ada');
    expect(await screen.findByText(/already goes by that name/)).toBeTruthy();
  });
});

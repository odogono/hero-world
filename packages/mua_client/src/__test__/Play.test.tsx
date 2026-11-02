import { afterEach, describe, expect, mock, test } from 'bun:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';

import { append, connectionLost, rejoined, sent } from '../transcript';

const commands: string[] = [];
void mock.module('../connection', () => ({
  logout: () => Promise.resolve(),
  sendCommand: (text: string) => {
    commands.push(text);
    return true;
  }
}));

const { Play } = await import('../Play');
const { actions, lines, status } = await import('../store');

afterEach(() => {
  cleanup();
  commands.length = 0;
  actions.value = [];
  lines.value = [];
  status.value = 'connecting';
});

const input = () => screen.getByLabelText('Command') as HTMLInputElement;

describe('the play screen', () => {
  test('takes commands only while joined', () => {
    status.value = 'offline';
    const { rerender } = render(<Play name="Ada" onLeft={() => {}} />);
    expect(input().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Offline');

    status.value = 'joined';
    rerender(<Play name="Ada" onLeft={() => {}} />);
    expect(input().disabled).toBe(false);
  });

  test('marks a command a drop left uncertain, and the gap', () => {
    status.value = 'joined';
    let [next] = sent([], 'take coin');
    next = rejoined(connectionLost(next));
    lines.value = append(next, { kind: 'output', text: 'Taken.' });

    render(<Play name="Ada" onLeft={() => {}} />);
    expect(screen.getByText(/unconfirmed/)).toBeTruthy();
    expect(screen.getByRole('separator').textContent).toMatch(
      /connection lost/
    );
  });

  test('shows a choice the server asks for', () => {
    lines.value = append([], {
      kind: 'prompt',
      options: ['the brass key', 'the iron key'],
      text: 'Which do you mean?'
    });

    render(<Play name="Ada" onLeft={() => {}} />);
    expect(screen.getByText('Which do you mean?')).toBeTruthy();
    expect(screen.getByText('the iron key')).toBeTruthy();
  });

  test('answers the latest choice by its number when clicked', () => {
    status.value = 'joined';
    const options = ['the brass key', 'the brass key'];
    let next = append([], {
      kind: 'prompt',
      options,
      text: 'Which do you mean?'
    });
    next = append(next, {
      kind: 'prompt',
      options,
      text: 'Which do you mean?'
    });
    lines.value = next;

    render(<Play name="Ada" onLeft={() => {}} />);
    const buttons = screen.getAllByRole('button', { name: 'the brass key' });
    // only the latest list can be answered
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(commands).toEqual(['2']);
  });

  test('offers the actions as chips that send the command', () => {
    status.value = 'joined';
    actions.value = ['north', 'take coin'];

    render(<Play name="Ada" onLeft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'take coin' }));
    expect(commands).toEqual(['take coin']);
  });

  test('disables the chips while not joined', () => {
    status.value = 'offline';
    actions.value = ['north'];

    render(<Play name="Ada" onLeft={() => {}} />);
    const chip = screen.getByRole('button', {
      name: 'north'
    }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });
});

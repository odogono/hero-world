import { afterEach, describe, expect, test } from 'bun:test';

import { cleanup, render, screen } from '@testing-library/preact';

import { Play } from '../Play';
import { lines, status } from '../store';
import { append, connectionLost, rejoined, sent } from '../transcript';

afterEach(() => {
  cleanup();
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
});

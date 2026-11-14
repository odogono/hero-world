import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/preact';

import { append, connectionLost, rejoined, sent } from '../transcript';

const commands: string[] = [];
let stopped = 0;
void mock.module('../connection', () => ({
  loadLocal: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  mirrorSnapshot: () => Promise.resolve(undefined),
  place: () => Promise.resolve({ ok: false, reason: 'not in tests' }),
  putAway: () => Promise.resolve({ ok: true }),
  saveEdit: () => Promise.resolve({ ok: true }),
  saveLocal: () => {},
  sendCommand: (text: string) => {
    commands.push(text);
    return true;
  },
  stopEditing: () => {
    stopped++;
    editing.value = null;
  }
}));

// the composer's Preview World, which never answers here
void mock.module('../preview/client', () => ({
  openPreviewClient: () => ({
    close: () => {},
    open: () => new Promise(() => {})
  })
}));

const { Play } = await import('../Play');
const {
  actions,
  builder,
  commands: sentCommands,
  editing,
  lines,
  pictureMode,
  status
} = await import('../store');

afterEach(() => {
  cleanup();
  commands.length = 0;
  actions.value = [];
  builder.value = null;
  editing.value = null;
  stopped = 0;
  lines.value = [];
  pictureMode.value = 'shown';
  sentCommands.value = [];
  status.value = 'connecting';
});

const input = () => screen.getByLabelText('Command') as HTMLTextAreaElement;

const badge = () => screen.getByRole('button', { name: /profile menu/ });

// Two places' Pictures, each before its description (ADR 0027)
const twoPictures = () => {
  let next = append([], {
    alt: 'Worn granite steps.',
    kind: 'picture',
    name: 'Harbour Steps',
    url: '/pictures/harbour_steps.png?vsn=a'
  });
  next = append(next, { kind: 'output', text: 'Harbour Steps' });
  next = append(next, {
    alt: 'A yard of cradles.',
    kind: 'picture',
    name: 'Boatyard',
    url: '/pictures/boatyard.png?vsn=b'
  });
  return append(next, { kind: 'output', text: 'Boatyard' });
};

const fold = (name: string) =>
  screen.getByRole('button', { name: new RegExp(name) });

describe("places' Pictures", () => {
  test('show the newest, and fold older ones to their names', () => {
    lines.value = twoPictures();
    render(<Play name="Ada" onLeft={() => {}} />);

    const images = screen.getAllByRole('img');
    expect(images.map(i => i.getAttribute('alt'))).toEqual([
      'A yard of cradles.'
    ]);
    expect(fold('Boatyard').getAttribute('aria-expanded')).toBe('true');
    expect(fold('Harbour Steps').getAttribute('aria-expanded')).toBe('false');
  });

  test('a folded Picture shows when its name is clicked, and folds again', () => {
    lines.value = twoPictures();
    render(<Play name="Ada" onLeft={() => {}} />);

    fireEvent.click(fold('Harbour Steps'));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    fireEvent.click(fold('Boatyard'));
    expect(screen.getAllByRole('img').map(i => i.getAttribute('alt'))).toEqual([
      'Worn granite steps.'
    ]);
  });

  test('arrive folded, or are left out, as the reader sets in the profile menu', () => {
    lines.value = twoPictures();
    render(<Play name="Ada" onLeft={() => {}} />);

    fireEvent.click(badge());
    fireEvent.click(screen.getByRole('menuitem', { name: /Pictures: shown/ }));
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(fold('Boatyard').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByRole('menuitem', { name: /Pictures: folded/ }));
    expect(screen.queryByRole('button', { name: /Boatyard/ })).toBeNull();
    expect(localStorage.getItem('mua-settings:pictures')).toBe('off');

    fireEvent.click(screen.getByRole('menuitem', { name: /Pictures: off/ }));
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});

describe('the play screen', () => {
  test('takes commands only while joined', () => {
    status.value = 'offline';
    const { rerender } = render(<Play name="Ada" onLeft={() => {}} />);
    expect(input().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Offline');
    expect(badge().getAttribute('aria-label')).toMatch(/Offline/);

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

  test('sends the command on Enter, and Shift+Enter starts a new line', () => {
    status.value = 'joined';
    render(<Play name="Ada" onLeft={() => {}} />);

    fireEvent.input(input(), {
      target: { value: 'ask world to named "lamp"' }
    });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(commands).toEqual([]);

    fireEvent.input(input(), {
      target: { value: ';ask world to named "lamp"\nchange it, "lit", {}' }
    });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(commands).toEqual([
      ';ask world to named "lamp"\nchange it, "lit", {}'
    ]);
    expect(input().value).toBe('');
  });

  test('sends with the button, which waits for a command', () => {
    status.value = 'joined';
    render(<Play name="Ada" onLeft={() => {}} />);
    const send = screen.getByRole('button', {
      name: 'Send'
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.input(input(), { target: { value: '  look  ' } });
    fireEvent.click(send);
    expect(commands).toEqual(['look']);
  });

  test('focuses the command box once the Character joins', () => {
    status.value = 'connecting';
    const { rerender } = render(<Play name="Ada" onLeft={() => {}} />);
    expect(document.activeElement).not.toBe(input());

    status.value = 'joined';
    rerender(<Play name="Ada" onLeft={() => {}} />);
    expect(document.activeElement).toBe(input());
  });
});

test('shows MUA and the version at the top', () => {
  render(<Play name="Ada" onLeft={() => {}} />);
  expect(screen.getByText('MUA')).toBeTruthy();
  expect(screen.getByText('v0.0.0-test')).toBeTruthy();
});

describe('the transcript', () => {
  test('follows new lines, unless the reader has scrolled back up', () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push('end');
    };
    try {
      lines.value = append([], { kind: 'output', text: 'one' });
      const { rerender } = render(<Play name="Ada" onLeft={() => {}} />);
      const transcript = screen.getByRole('list', { name: 'Transcript' });
      expect(scrolled).toHaveLength(1);

      // scrolled up: far from the bottom
      Object.defineProperties(transcript, {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 1000 },
        scrollTop: { configurable: true, value: 0, writable: true }
      });
      fireEvent.scroll(transcript);
      lines.value = append(lines.value, { kind: 'output', text: 'two' });
      rerender(<Play name="Ada" onLeft={() => {}} />);
      expect(scrolled).toHaveLength(1);

      // back at the bottom
      transcript.scrollTop = 900;
      fireEvent.scroll(transcript);
      lines.value = append(lines.value, { kind: 'output', text: 'three' });
      rerender(<Play name="Ada" onLeft={() => {}} />);
      expect(scrolled).toHaveLength(2);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('the profile badge', () => {
  test('opens a menu with who is signed in, and closes on Escape', () => {
    render(<Play admin email="ada@example.com" name="ada" onLeft={() => {}} />);
    expect(badge().textContent).toBe('A');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(badge());
    expect(badge().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByRole('menu').textContent).toMatch(/Connecting…/);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(badge());
  });

  test('shows no Admin tag for a player', () => {
    render(<Play email="bob@example.com" name="Bob" onLeft={() => {}} />);
    fireEvent.click(badge());
    expect(screen.queryByText('Admin')).toBeNull();
  });

  test('signs out from the menu', async () => {
    let left = false;
    render(<Play name="Ada" onLeft={() => (left = true)} />);
    fireEvent.click(badge());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(left).toBe(true));
  });

  test('recalls sent commands with the arrow keys, keeping the draft', () => {
    status.value = 'joined';
    render(<Play name="Ada" onLeft={() => {}} />);
    for (const text of ['look', 'north']) {
      fireEvent.input(input(), { target: { value: text } });
      fireEvent.keyDown(input(), { key: 'Enter' });
    }
    expect(sentCommands.value).toEqual(['look', 'north']);

    fireEvent.input(input(), { target: { value: 'ta' } });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('north');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('look');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().value).toBe('ta');
  });

  test('clears the transcript', () => {
    lines.value = append([], { kind: 'output', text: 'Hall' });
    render(<Play name="Ada" onLeft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lines.value).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  test('tells a reload apart from a dropped connection', () => {
    lines.value = append(append([], { kind: 'output', text: 'Hall' }), {
      kind: 'gap',
      reason: 'reload'
    });
    render(<Play name="Ada" onLeft={() => {}} />);
    expect(screen.getByRole('separator').textContent).toContain('reloaded');
  });

  test('offers Compose to a Builder only, and opens the Composer beside the transcript', () => {
    status.value = 'joined';
    const { container, rerender } = render(
      <Play name="Ada" onLeft={() => {}} />
    );
    expect(screen.queryByRole('button', { name: 'Compose' })).toBeNull();

    builder.value = { max_capacity: 20, max_placed: 50, placed: 0 };
    rerender(<Play name="Ada" onLeft={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compose' }));
    expect(
      screen.getByRole('complementary', { name: 'Composer' })
    ).toBeTruthy();
    expect(container.querySelector('.play.composing')).toBeTruthy();
    expect(screen.getByLabelText('Transcript')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to play' }));
    expect(
      screen.queryByRole('complementary', { name: 'Composer' })
    ).toBeNull();
    expect(stopped).toBe(0);
  });

  test('a line offers its Suggestions, which send their Command (#275)', () => {
    status.value = 'joined';
    lines.value = append([], {
      kind: 'output',
      suggestions: ['edit the satchel'],
      text: 'You make the satchel.'
    });
    lines.value = append(lines.value, { kind: 'output', text: 'Later.' });

    render(<Play name="Ada" onLeft={() => {}} />);
    // an older line's Suggestion still sends
    fireEvent.click(screen.getByRole('button', { name: 'edit the satchel' }));
    expect(commands).toEqual(['edit the satchel']);
  });

  test('opens a thing the edit Verb opened, and closing it stops the edit (#275)', () => {
    status.value = 'joined';
    builder.value = { max_capacity: 20, max_placed: 50, placed: 0 };
    const { rerender } = render(<Play name="Ada" onLeft={() => {}} />);
    expect(
      screen.queryByRole('complementary', { name: 'Composer' })
    ).toBeNull();

    editing.value = {
      composition: { described: { description: '', name: 'Satchel' } },
      eid: 42
    };
    rerender(<Play name="Ada" onLeft={() => {}} />);
    expect(
      screen.getByRole('heading', { name: 'Editing the satchel' })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to play' }));
    expect(stopped).toBe(1);
    expect(
      screen.queryByRole('complementary', { name: 'Composer' })
    ).toBeNull();
  });
});

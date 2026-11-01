import { describe, expect, it } from 'bun:test';

import { mask, unmask } from '../../utils/masked-input';

describe('masked input', () => {
  it('shows a mask character for each character', () => {
    expect(mask('hunter2')).toBe('•••••••');
  });

  it('adds what is typed at the end', () => {
    expect(unmask('hunt', '••••e')).toBe('hunte');
    expect(unmask('', 'h')).toBe('h');
  });

  it('removes what is deleted from the end', () => {
    expect(unmask('hunter2', '•••••')).toBe('hunte');
    expect(unmask('abc', '')).toBe('');
  });
});

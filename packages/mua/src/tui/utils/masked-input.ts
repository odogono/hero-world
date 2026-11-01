/** The character shown for each character of a masked input, such as a password */
export const MASK = '•';

/**
 * The real text behind a masked input after an edit. The input shows only
 * mask characters, so a longer display means characters were typed at the
 * end, and a shorter one means some were deleted from it.
 */
export const unmask = (real: string, displayed: string): string => {
  if (displayed.length > real.length) {
    return real + displayed.slice(real.length).replaceAll(MASK, '');
  }
  return real.slice(0, displayed.length);
};

/** What a masked input shows for this text */
export const mask = (real: string) => MASK.repeat(real.length);

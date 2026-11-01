/** The rules for names and passwords, and how passwords are kept */

/** Wrong passwords allowed before the connection is closed */
export const MAX_LOGIN_ATTEMPTS = 3;

export const MIN_PASSWORD_LENGTH = 4;

/** A name: a letter, then letters, digits, `-` or `_`; 2 to 20 in all */
export const isValidName = (name: string) => /^[a-z][\w-]{1,19}$/i.test(name);

export type PasswordOptions = {
  /** bcrypt's cost; lower is faster and weaker (tests use the minimum) */
  cost?: number;
};

export const hashPassword = (
  password: string,
  { cost = 10 }: PasswordOptions = {}
) => Bun.password.hash(password, { algorithm: 'bcrypt', cost });

export const verifyPassword = (password: string, hash: string) =>
  Bun.password.verify(password, hash);

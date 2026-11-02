import type { Character, Session } from './store';

const json = (method: string, body?: unknown): RequestInit => ({
  body: body === undefined ? undefined : JSON.stringify(body),
  credentials: 'same-origin',
  headers: { 'content-type': 'application/json' },
  method
});

/** The signed-in Account and its Characters, or `null` when signed out */
export const getSession = async (): Promise<Session | null> => {
  const response = await fetch('/api/session', json('GET'));
  return response.ok ? ((await response.json()) as Session) : null;
};

/** The development sign-in: an email stands in for a Google identity */
export const devSignIn = async (email: string) => {
  const response = await fetch('/auth/dev', json('POST', { email }));
  return response.ok;
};

export type CreateResult =
  | { character: Pick<Character, 'id' | 'name'>; ok: true }
  | { error: string; ok: false };

export const createCharacter = async (name: string): Promise<CreateResult> => {
  const response = await fetch('/api/character', json('POST', { name }));
  const body = (await response.json()) as Record<string, unknown>;
  if (response.ok) {
    return { character: body as Pick<Character, 'id' | 'name'>, ok: true };
  }
  return { error: String(body.error ?? 'error'), ok: false };
};

export const signOut = () => fetch('/auth', json('DELETE'));

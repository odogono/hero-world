import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createServer } from '../index';

describe('requireAuth', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ enableLogging: false });
  });

  afterAll(async () => {
    await app.stop?.();
  });

  const get = (path: string, token?: string) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {}
      })
    );

  it.each(['/user', '/test/data'])('refuses %s without a token', async path => {
    const res = await get(path);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('serves the user their profile with a token', async () => {
    const res = await get('/user', 'mock_access_token_test');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      profile: { email: 'user@example.com' }
    });
  });

  it('leaves unprotected routes open', async () => {
    expect((await get('/health')).status).toBe(200);
  });
});

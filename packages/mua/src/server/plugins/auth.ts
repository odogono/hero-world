import { Elysia } from 'elysia';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createLog } from 'odgn-helpers/log';

import { bearer } from '@elysiajs/bearer';

export type AuthUser = {
  [key: string]: unknown;
  email?: string;
  name?: string;
  sub: string;
}

const log = createLog('auth-plugin');

// Google OAuth JWKS endpoint
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);

export const verifyToken = async (token: string): Promise<AuthUser> => {
  // Check if this is a mock token from device flow
  if (token.startsWith('mock_access_token_')) {
    // For development/testing with device flow
    return {
      email: 'user@example.com',
      name: 'Test User',
      sub: 'mock_user_id'
    };
  }

  // Verify real Google JWT tokens
  const { payload } = await jwtVerify(token, JWKS, {
    audience: process.env.GOOGLE_CLIENT_ID,
    issuer: 'https://accounts.google.com'
  });

  return payload as AuthUser;
};

export const authPlugin = new Elysia({ name: 'auth' })
  .use(bearer())
  .derive(
    { as: 'global' },
    async ({ bearer }): Promise<{ user: AuthUser | null }> => {
      try {
        const user = await verifyToken(bearer ?? '');
        return { user };
      } catch (error) {
        log.error('Token verification failed:', error);
        return { user: null };
      }
    }
  )
  .macro(({ onBeforeHandle }) => ({
    requireAuth(enabled: boolean = true) {
      if (!enabled) {
        return;
      }

      onBeforeHandle(({ set, user }) => {
        log.info('requireAuth', { enabled, user });
        if (!user) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
      });
    }
  }));

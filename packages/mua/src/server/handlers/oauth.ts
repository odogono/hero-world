import { Elysia } from 'elysia';
import { createLog } from 'odgn-helpers/log';

import {
  initiateDeviceFlow,
  pollDeviceAuth,
  simulateUserAuthorization
} from './device-auth';

const log = createLog('oauth');

export const oauthHandler = (app: any) =>
  app
    // Device Authorization Grant endpoints
    .post('/device', async () => {
      try {
        const response = await initiateDeviceFlow();
        return response;
      } catch (error) {
        log.error('Failed to initiate device flow:', error);
        return { error: 'Failed to initiate device flow' };
      }
    })
    .post('/token', async ({ body }: { body: any }) => {
      try {
        const { device_code } = body as { device_code: string };
        const response = await pollDeviceAuth(device_code);

        if (response) {
          return response;
        } else {
          return {
            error: 'authorization_pending',
            error_description: 'The authorization request is still pending'
          };
        }
      } catch (error) {
        log.error('Failed to poll device auth:', error);
        return {
          error: 'invalid_grant',
          error_description:
            error instanceof Error ? error.message : 'Unknown error'
        };
      }
    })
    // Development/testing endpoint to simulate user authorization
    .post('/simulate-auth', async ({ body }: { body: any }) => {
      try {
        const { user_code } = body as { user_code: string };
        await simulateUserAuthorization(user_code);
        return { success: true };
      } catch (error) {
        log.error('Failed to simulate user authorization:', error);
        return {
          error: 'invalid_request',
          error_description:
            error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

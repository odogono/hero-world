import dotenv from 'dotenv';
import { createLog } from 'odgn-helpers/log';

import type { AuthUser } from '../plugins/auth';

dotenv.config();

const log = createLog('client-handler');

export const testDataHandler = ({ user }: { user: AuthUser }) => {
  log.info('testDataHandler', user);
  return {
    data: {
      items: [
        { id: 1, name: 'Protected Item 1', userId: user.id },
        { id: 2, name: 'Protected Item 2', userId: user.id },
        { id: 3, name: 'Protected Item 3', userId: user.id }
      ],
      total: 3
    },
    message: 'This is protected data',
    timestamp: new Date().toISOString(),
    user: {
      email: user.email,
      id: user.id
    }
  };
};

export const userProfileHandler = ({ user }: { user: AuthUser }) => ({
  message: 'User profile retrieved successfully',
  profile: {
    email: user.email,
    id: user.id,
    lastAccessed: new Date().toISOString()
  },
  timestamp: new Date().toISOString()
});

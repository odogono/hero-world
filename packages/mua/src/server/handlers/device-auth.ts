import { createLog } from 'odgn-helpers/log';
import { tryCatch } from 'odgn-helpers/trycatch';

const log = createLog('device-auth');

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface DeviceAuthState {
  device_code: string;
  user_code: string;
  expires_at: number;
  interval: number;
  status: 'pending' | 'authorized' | 'expired' | 'denied';
  access_token?: string;
  refresh_token?: string;
  user?: {
    sub: string;
    email?: string;
    name?: string;
  };
}

// In-memory storage for device codes (in production, use Redis or database)
const deviceAuthStates = new Map<string, DeviceAuthState>();

export const generateDeviceCode = (): string => {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
};

export const generateUserCode = (): string => {
  // Generate a user-friendly code (e.g., ABCD-EFGH)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) result += '-';
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const initiateDeviceFlow = async (): Promise<DeviceCodeResponse> => {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresIn = 600; // 10 minutes
  const interval = 5; // 5 seconds

  const state: DeviceAuthState = {
    device_code: deviceCode,
    user_code: userCode,
    expires_at: Date.now() + expiresIn * 1000,
    interval,
    status: 'pending'
  };

  deviceAuthStates.set(deviceCode, state);

  log.info('Device flow initiated', { deviceCode, userCode });

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: 'https://accounts.google.com/device',
    verification_uri_complete: `https://accounts.google.com/device?user_code=${userCode}`,
    expires_in: expiresIn,
    interval
  };
};

export const pollDeviceAuth = async (
  deviceCode: string
): Promise<DeviceTokenResponse | null> => {
  const state = deviceAuthStates.get(deviceCode);

  if (!state) {
    throw new Error('Device code not found');
  }

  if (state.status === 'expired') {
    throw new Error('Device code has expired');
  }

  if (state.status === 'denied') {
    throw new Error('User denied the authorization request');
  }

  if (state.status === 'authorized' && state.access_token) {
    return {
      access_token: state.access_token,
      token_type: 'Bearer',
      expires_in: 3600, // 1 hour
      refresh_token: state.refresh_token,
      scope: 'openid email profile'
    };
  }

  return null; // Still pending
};

export const simulateUserAuthorization = async (
  userCode: string
): Promise<void> => {
  // In a real implementation, this would be called by Google's OAuth service
  // after the user completes authorization in their browser
  // For now, we'll simulate it for testing purposes

  log.debug('Simulating user authorization', { userCode });

  const state = Array.from(deviceAuthStates.values()).find(
    s => s.user_code === userCode
  );

  if (!state) {
    throw new Error(`User code ${userCode} not found`);
  }

  if (state.status === 'expired') {
    throw new Error('Device code has expired');
  }

  // Simulate getting tokens from Google
  const mockAccessToken = `mock_access_token_${Date.now()}`;
  const mockRefreshToken = `mock_refresh_token_${Date.now()}`;

  state.status = 'authorized';
  state.access_token = mockAccessToken;
  state.refresh_token = mockRefreshToken;
  state.user = {
    sub: `google_user_${Date.now()}`,
    email: 'user@example.com',
    name: 'Test User'
  };

  log.info('User authorization completed', {
    userCode,
    deviceCode: state.device_code
  });
};

// Cleanup expired device codes
setInterval(() => {
  const now = Date.now();
  for (const [deviceCode, state] of deviceAuthStates.entries()) {
    if (state.expires_at < now && state.status === 'pending') {
      state.status = 'expired';
      log.info('Device code expired', { deviceCode });
    }
  }
}, 60000); // Check every minute

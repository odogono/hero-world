import { createLog } from 'odgn-helpers/log';

const log = createLog('device-auth');

export type DeviceCodeResponse = {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
};

export type DeviceTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export type DeviceAuthState = {
  access_token?: string;
  device_code: string;
  expires_at: number;
  interval: number;
  refresh_token?: string;
  status: 'pending' | 'authorized' | 'expired' | 'denied';
  user?: {
    email?: string;
    name?: string;
    sub: string;
  };
  user_code: string;
};

// In-memory storage for device codes (in production, use Redis or database)
const deviceAuthStates = new Map<string, DeviceAuthState>();

export const generateDeviceCode = (): string =>
  Math.random().toString(36).slice(2, 15) +
  Math.random().toString(36).slice(2, 15);

export const generateUserCode = (): string => {
  // Generate a user-friendly code (e.g., ABCD-EFGH)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) {
      result += '-';
    }
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
    expires_at: Date.now() + expiresIn * 1000,
    interval,
    status: 'pending',
    user_code: userCode
  };

  deviceAuthStates.set(deviceCode, state);

  log.info('Device flow initiated', { deviceCode, userCode });

  return {
    device_code: deviceCode,
    expires_in: expiresIn,
    interval,
    user_code: userCode,
    verification_uri: 'https://accounts.google.com/device',
    verification_uri_complete: `https://accounts.google.com/device?user_code=${userCode}`
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
      expires_in: 3600, // 1 hour
      refresh_token: state.refresh_token,
      scope: 'openid email profile',
      token_type: 'Bearer'
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
    email: 'user@example.com',
    name: 'Test User',
    sub: `google_user_${Date.now()}`
  };

  log.info('User authorization completed', {
    deviceCode: state.device_code,
    userCode
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
}, 60_000); // Check every minute

#!/usr/bin/env bun

/**
 * Example CLI tool demonstrating OAuth2 Device Authorization Grant flow
 *
 * Usage:
 *   bun run examples/cli-auth.ts
 */
import { createLog } from 'odgn-helpers/log';

const log = createLog('cli-auth');

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface ErrorResponse {
  error: string;
  error_description?: string;
}

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  const response = await fetch(`${SERVER_URL}/oauth/device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to initiate device flow: ${response.statusText}`);
  }

  return response.json();
}

async function pollForToken(
  deviceCode: string,
  interval: number
): Promise<DeviceTokenResponse> {
  const maxAttempts = 120; // 10 minutes max (120 * 5 seconds)
  let attempts = 0;

  while (attempts < maxAttempts) {
    const response = await fetch(`${SERVER_URL}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ device_code: deviceCode })
    });

    const data = await response.json();

    if (response.ok) {
      return data as DeviceTokenResponse;
    }

    const errorData = data as ErrorResponse;

    if (errorData.error === 'authorization_pending') {
      log.info(
        `Authorization pending... (attempt ${attempts + 1}/${maxAttempts})`
      );
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      attempts++;
    } else {
      throw new Error(
        `Token request failed: ${errorData.error_description || errorData.error}`
      );
    }
  }

  throw new Error(
    'Authorization timeout - user did not complete authorization in time'
  );
}

async function makeAuthenticatedRequest(accessToken: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Authenticated request failed: ${response.statusText}`);
  }

  const userData = await response.json();
  log.info('Authenticated request successful:', userData);
}

async function simulateUserAuth(userCode: string): Promise<void> {
  // This simulates the user completing authorization in their browser
  // In a real implementation, this would be handled by Google's OAuth service
  const response = await fetch(`${SERVER_URL}/oauth/simulate-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user_code: userCode })
  });

  if (!response.ok) {
    throw new Error(`Failed to simulate user auth: ${response.statusText}`);
  }

  log.info('User authorization simulated successfully');
}

async function main() {
  try {
    log.info('Starting OAuth2 Device Authorization Grant flow...');

    // Step 1: Initiate device flow
    const deviceResponse = await initiateDeviceFlow();

    log.info('Device flow initiated successfully!');
    log.info(`Please visit: ${deviceResponse.verification_uri_complete}`);
    log.info(`Or manually enter code: ${deviceResponse.user_code}`);
    log.info(`Device code expires in: ${deviceResponse.expires_in} seconds`);

    // Step 2: Simulate user authorization (for testing)
    // In production, the user would complete this in their browser
    log.info('Simulating user authorization...');
    await simulateUserAuth(deviceResponse.user_code);

    // Step 3: Poll for access token
    log.info('Polling for access token...');
    const tokenResponse = await pollForToken(
      deviceResponse.device_code,
      deviceResponse.interval
    );

    log.info('Access token received successfully!');
    log.info(`Token type: ${tokenResponse.token_type}`);
    log.info(`Expires in: ${tokenResponse.expires_in} seconds`);

    // Step 4: Make authenticated request
    log.info('Making authenticated request...');
    await makeAuthenticatedRequest(tokenResponse.access_token);

    log.info('OAuth2 Device Authorization Grant flow completed successfully!');
  } catch (error) {
    log.error('OAuth2 flow failed:', error);
    process.exit(1);
  }
}

// Run the example
main();

/**
 * GitHub OAuth Device Flow implementation for CLI
 *
 * Implements RFC 8628 Device Authorization Grant
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

import { GITHUB_OAUTH, FORJ_GITHUB_SCOPES } from '@forj/shared';
import { logger } from '../utils/logger.js';
import { ForjError } from '../utils/errors.js';
import { setGitHubToken, getGitHubToken, clearGitHubToken as clearToken } from './config.js';
import open from 'open';

/**
 * Forj GitHub OAuth App Client ID (public)
 * TODO: Replace with actual Forj GitHub App client ID once registered
 */
const FORJ_GITHUB_CLIENT_ID = process.env.FORJ_GITHUB_CLIENT_ID || 'Iv1.placeholder_client_id';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface AccessTokenErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
}

/**
 * Initiate GitHub OAuth Device Flow
 */
export async function initiateGitHubAuth(): Promise<DeviceCodeResponse> {
  const response = await fetch(GITHUB_OAUTH.DEVICE_CODE, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: FORJ_GITHUB_CLIENT_ID,
      scope: FORJ_GITHUB_SCOPES.join(' '),
    }).toString(),
  });

  if (!response.ok) {
    throw new ForjError(
      `GitHub OAuth initiation failed: ${response.statusText}`,
      'GITHUB_AUTH_FAILED'
    );
  }

  const data = (await response.json()) as DeviceCodeResponse;
  return data;
}

/**
 * Poll for GitHub access token
 */
export async function pollForGitHubToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  const startTime = Date.now();
  const expiryTime = startTime + expiresIn * 1000;

  while (Date.now() < expiryTime) {
    // Wait for the specified interval
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await fetch(GITHUB_OAUTH.ACCESS_TOKEN, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: FORJ_GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });

    if (!response.ok) {
      throw new ForjError(
        `GitHub token polling failed: ${response.statusText}`,
        'GITHUB_AUTH_FAILED'
      );
    }

    const data = (await response.json()) as AccessTokenResponse | AccessTokenErrorResponse;

    // Check if it's an error response
    if ('error' in data) {
      switch (data.error) {
        case 'authorization_pending':
          // User hasn't authorized yet, continue polling
          continue;
        case 'slow_down':
          // Increase polling interval
          interval = interval + 5;
          continue;
        case 'expired_token':
          throw new ForjError(
            'GitHub authorization expired. Please try again.',
            'GITHUB_AUTH_EXPIRED'
          );
        case 'access_denied':
          throw new ForjError(
            'GitHub authorization was denied.',
            'GITHUB_AUTH_DENIED'
          );
        default:
          throw new ForjError(
            `GitHub authorization failed: ${data.error_description || data.error}`,
            'GITHUB_AUTH_FAILED'
          );
      }
    }

    // Success! Return the access token
    return data.access_token;
  }

  throw new ForjError(
    'GitHub authorization timed out. Please try again.',
    'GITHUB_AUTH_TIMEOUT'
  );
}

/**
 * Complete GitHub authentication flow
 */
export async function authenticateGitHub(): Promise<string> {
  logger.info('Starting GitHub authentication...');

  // Step 1: Initiate device flow
  const deviceAuth = await initiateGitHubAuth();

  // Step 2: Display user code and open browser
  logger.info('');
  logger.info('GitHub Authentication');
  logger.info('────────────────────');
  logger.success(`User Code: ${deviceAuth.user_code}`);
  logger.info(`Verification URL: ${deviceAuth.verification_uri}`);
  logger.info('');
  logger.info('Opening browser to authenticate with GitHub...');
  logger.dim('If browser doesn\'t open, visit the URL above and enter the code.');
  logger.info('');

  // Open browser
  try {
    await open(deviceAuth.verification_uri);
  } catch (error) {
    logger.warn('Failed to open browser automatically');
  }

  // Step 3: Poll for token
  logger.info('Waiting for authorization...');
  const accessToken = await pollForGitHubToken(
    deviceAuth.device_code,
    deviceAuth.interval,
    deviceAuth.expires_in
  );

  logger.success('GitHub authentication successful!');

  // Step 4: Store token in config
  setGitHubToken(accessToken);

  return accessToken;
}

/**
 * Check if GitHub is authenticated
 */
export function isGitHubAuthenticated(): boolean {
  return !!getGitHubToken();
}

/**
 * Clear GitHub token from config
 */
export function clearGitHubToken(): void {
  clearToken();
}

// Re-export getGitHubToken for convenience
export { getGitHubToken } from './config.js';

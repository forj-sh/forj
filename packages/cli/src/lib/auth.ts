import { getAuthToken, setAuthToken, clearAuthToken, getApiUrl } from './config.js';
import { api } from './api-client.js';
import { ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import open from 'open';

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const token = getAuthToken();
  return !!token;
}

/**
 * Ensure user is authenticated, triggering login flow if needed.
 * Returns silently if already authenticated.
 */
export async function ensureAuthenticated(): Promise<void> {
  if (isAuthenticated()) {
    return;
  }

  logger.info('Authentication required. Starting GitHub login...\n');
  await login();
}

interface DeviceFlowResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface PollResponse {
  status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'authorized';
  username?: string;
  message?: string;
  token?: string;
  user?: {
    id: string;
    email: string;
  };
}

/**
 * Authenticate via GitHub Device Flow through the Forj API.
 *
 * 1. POST /auth/github/device → get user code
 * 2. User enters code at github.com/login/device
 * 3. POST /auth/github/poll → poll until authorized, returns JWT
 * 4. Store JWT in ~/.forj/config.json
 */
export async function login(): Promise<void> {
  // Step 1: Initiate device flow via Forj API
  const deviceFlow = await api.post<DeviceFlowResponse>(
    '/auth/github/device',
    {},
    false
  );

  // Step 2: Show user code and open browser
  logger.log('');
  logger.log('  GitHub Authentication');
  logger.log('  ────────────────────');
  logger.success(`  Code: ${deviceFlow.userCode}`);
  logger.dim(`  Enter this code at: ${deviceFlow.verificationUri}`);
  logger.log('');

  try {
    await open(deviceFlow.verificationUri);
  } catch {
    // Browser didn't open — user can visit URL manually
  }

  // Step 3: Poll for authorization
  const spinner = logger.spinner('Waiting for GitHub authorization...');
  spinner.start();

  let interval = deviceFlow.interval;
  const expiryTime = Date.now() + deviceFlow.expiresIn * 1000;

  while (Date.now() < expiryTime) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const poll = await api.post<PollResponse>(
      '/auth/github/poll',
      { deviceCode: deviceFlow.deviceCode },
      false
    );

    switch (poll.status) {
      case 'authorized':
        if (!poll.token) {
          throw new ForjError('Server returned authorized status without token', 'AUTH_ERROR');
        }
        setAuthToken(poll.token);
        spinner.succeed(`Authenticated as ${poll.username || 'GitHub user'}`);
        return;

      case 'pending':
        continue;

      case 'slow_down':
        interval += 5;
        continue;

      case 'expired':
        spinner.fail('Authorization expired');
        throw new ForjError(
          'GitHub authorization expired. Please try again.',
          'GITHUB_AUTH_EXPIRED'
        );

      case 'denied':
        spinner.fail('Authorization denied');
        throw new ForjError(
          'GitHub authorization was denied.',
          'GITHUB_AUTH_DENIED'
        );
    }
  }

  spinner.fail('Authorization timed out');
  throw new ForjError(
    'GitHub authorization timed out. Please try again.',
    'GITHUB_AUTH_TIMEOUT'
  );
}

/**
 * Log out and clear stored credentials
 */
export function logout(): void {
  if (!isAuthenticated()) {
    logger.warn('Not currently logged in');
    return;
  }

  clearAuthToken();
  logger.success('Logged out successfully');
}

/**
 * Get current authentication status
 */
export function getAuthStatus(): {
  authenticated: boolean;
  apiUrl: string;
} {
  return {
    authenticated: isAuthenticated(),
    apiUrl: getApiUrl(),
  };
}

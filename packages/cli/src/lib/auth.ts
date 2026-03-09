import { getAuthToken, clearAuthToken, getApiUrl } from './config.js';
import { ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const token = getAuthToken();
  return !!token;
}

/**
 * Initiate OAuth login flow
 * Opens browser to authenticate with Forj
 */
export async function login(): Promise<void> {
  const apiUrl = getApiUrl();
  const authUrl = `${apiUrl}/auth/cli`;

  logger.info('Opening browser for authentication...');
  logger.dim(`If browser doesn't open, visit: ${authUrl}`);

  // TODO: In a real implementation:
  // 1. Open browser to authUrl
  // 2. User authenticates and authorizes CLI
  // 3. API redirects to localhost callback with token
  // 4. CLI captures token from callback
  // 5. Store token in config

  // For now, this is a placeholder
  throw new ForjError(
    'Login not yet implemented. This will open an OAuth flow in your browser.',
    'NOT_IMPLEMENTED'
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

/**
 * Vercel API token guided creation flow
 *
 * Vercel doesn't support standard OAuth for third-party CLI apps,
 * so we guide users through creating an API token manually.
 */

import { VercelClient } from '@forj/shared';
import { logger } from '../utils/logger.js';
import { ForjError } from '../utils/errors.js';
import { setVercelToken, getVercelToken, clearVercelToken as clearToken } from './config.js';
import open from 'open';
import inquirer from 'inquirer';

/**
 * Guide user through creating a Vercel API token
 */
export async function guideVercelTokenCreation(): Promise<void> {
  logger.info('Vercel API Token Setup');
  logger.info('─────────────────────');
  logger.info('');
  logger.info('Forj needs a Vercel API token to create projects and configure domains.');
  logger.info('');
  logger.info('We\'ll open Vercel\'s token creation page for you.');
  logger.info('');

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Open Vercel token creation page?',
      default: true,
    },
  ]);

  if (!proceed) {
    throw new ForjError('Vercel authentication cancelled', 'AUTH_CANCELLED');
  }

  const tokenUrl = 'https://vercel.com/account/tokens';

  logger.info('Opening Vercel dashboard...');
  logger.dim('If browser doesn\'t open, visit: ' + tokenUrl);
  logger.info('');

  try {
    await open(tokenUrl);
  } catch (error) {
    logger.warn('Failed to open browser automatically');
  }

  logger.info('Steps to create the token:');
  logger.info('  1. Click "Create" to create a new token');
  logger.info('  2. Name it "Forj CLI" (or anything memorable)');
  logger.info('  3. Scope: "Full Account" (required for project creation)');
  logger.info('  4. Expiration: choose your preference');
  logger.info('  5. Click "Create Token"');
  logger.info('  6. Copy the token (you won\'t be able to see it again!)');
  logger.info('');
}

/**
 * Prompt user to enter Vercel API token
 */
export async function promptForVercelToken(): Promise<string> {
  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Paste your Vercel API token:',
      mask: '*',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Token cannot be empty';
        }
        if (input.trim().length < 20) {
          return 'Token appears to be too short';
        }
        return true;
      },
    },
  ]);

  return token.trim();
}

/**
 * Verify Vercel API token works
 */
export async function verifyVercelToken(token: string): Promise<boolean> {
  try {
    const client = new VercelClient({ token });
    const user = await client.getUser();

    logger.success('This API Token is valid and active');
    logger.dim(`Username: ${user.username}`);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Token verification failed: ${message}`);
    return false;
  }
}

/**
 * Complete Vercel authentication flow
 */
export async function authenticateVercel(): Promise<string> {
  await guideVercelTokenCreation();

  let token: string;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    token = await promptForVercelToken();

    logger.info('Verifying token...');
    const isValid = await verifyVercelToken(token);

    if (isValid) {
      setVercelToken(token);
      logger.success('Vercel authentication successful!');
      return token;
    }

    attempts++;
    if (attempts < maxAttempts) {
      logger.warn(`Invalid token. ${maxAttempts - attempts} attempt(s) remaining.`);
      logger.info('');
    }
  }

  throw new ForjError(
    'Failed to authenticate with Vercel after 3 attempts',
    'VERCEL_AUTH_FAILED'
  );
}

/**
 * Check if Vercel is authenticated
 */
export function isVercelAuthenticated(): boolean {
  return !!getVercelToken();
}

/**
 * Clear Vercel token from config
 */
export function clearVercelToken(): void {
  clearToken();
}

// Re-export getVercelToken for convenience
export { getVercelToken } from './config.js';

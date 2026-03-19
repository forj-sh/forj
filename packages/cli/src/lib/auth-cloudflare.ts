/**
 * Cloudflare API token guided creation flow
 *
 * Cloudflare doesn't support standard OAuth for third-party apps,
 * so we guide users through creating an API token manually.
 */

import { CloudflareClient } from '@forj/shared';
import { logger } from '../utils/logger.js';
import { ForjError } from '../utils/errors.js';
import { setCloudflareToken, getCloudflareToken, clearCloudflareToken as clearToken } from './config.js';
import open from 'open';
import inquirer from 'inquirer';

/**
 * Guide user through creating a Cloudflare API token
 */
export async function guideCloudflareTokenCreation(): Promise<void> {
  logger.info('Cloudflare API Token Setup');
  logger.info('─────────────────────────');
  logger.info('');
  logger.info('Forj needs a Cloudflare API token with these permissions:');
  logger.info('');
  logger.info('  Account:  Account Settings → Read');
  logger.info('  Zone:     Zone → Read, Zone Settings → Edit, DNS → Edit');
  logger.info('');
  logger.info('We\'ll open Cloudflare\'s token creation page for you.');
  logger.info('');

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Open Cloudflare token creation page?',
      default: true,
    },
  ]);

  if (!proceed) {
    throw new ForjError('Cloudflare authentication cancelled', 'AUTH_CANCELLED');
  }

  // Cloudflare API token creation URL with pre-filled template
  const tokenUrl = 'https://dash.cloudflare.com/profile/api-tokens';

  logger.info('Opening Cloudflare dashboard...');
  logger.dim('If browser doesn\'t open, visit: ' + tokenUrl);
  logger.info('');

  try {
    await open(tokenUrl);
  } catch (error) {
    logger.warn('Failed to open browser automatically');
  }

  logger.info('Steps to create the token:');
  logger.info('  1. Click "Create Token" → "Create Custom Token"');
  logger.info('  2. Add permissions:');
  logger.info('     - Account → Account Settings → Read');
  logger.info('     - Zone → Zone → Read');
  logger.info('     - Zone → Zone Settings → Edit');
  logger.info('     - Zone → DNS → Edit');
  logger.info('  3. Account Resources → Include → All accounts');
  logger.info('  4. Zone Resources → Include → All zones');
  logger.info('  5. Click "Continue to summary" → "Create Token"');
  logger.info('  6. Copy the token (you won\'t be able to see it again!)');
  logger.info('');
}

/**
 * Prompt user to enter Cloudflare API token
 */
export async function promptForCloudflareToken(): Promise<string> {
  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Paste your Cloudflare API token:',
      mask: '*',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Token cannot be empty';
        }
        // Cloudflare tokens are typically 40 characters
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
 * Verify Cloudflare API token works
 */
export async function verifyCloudflareToken(token: string): Promise<boolean> {
  try {
    const client = new CloudflareClient({ apiToken: token });
    const verification = await client.verifyToken();

    if (verification.status !== 'active') {
      logger.error(`Token status: ${verification.status}`);
      return false;
    }

    logger.success('This API Token is valid and active');
    logger.dim(`Token ID: ${verification.id}`);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Token verification failed: ${message}`);
    return false;
  }
}

/**
 * Complete Cloudflare authentication flow
 */
export async function authenticateCloudflare(): Promise<string> {
  // Guide user through token creation
  await guideCloudflareTokenCreation();

  // Prompt for token
  let token: string;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    token = await promptForCloudflareToken();

    logger.info('Verifying token...');
    const isValid = await verifyCloudflareToken(token);

    if (isValid) {
      // Store token in config
      setCloudflareToken(token);

      logger.success('Cloudflare authentication successful!');
      return token;
    }

    attempts++;
    if (attempts < maxAttempts) {
      logger.warn(`Invalid token. ${maxAttempts - attempts} attempt(s) remaining.`);
      logger.info('');
    }
  }

  throw new ForjError(
    'Failed to authenticate with Cloudflare after 3 attempts',
    'CLOUDFLARE_AUTH_FAILED'
  );
}

/**
 * Check if Cloudflare is authenticated
 */
export function isCloudflareAuthenticated(): boolean {
  return !!getCloudflareToken();
}

/**
 * Clear Cloudflare token from config
 */
export function clearCloudflareToken(): void {
  clearToken();
}

// Re-export getCloudflareToken for convenience
export { getCloudflareToken } from './config.js';

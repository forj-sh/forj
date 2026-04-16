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
import chalk from 'chalk';

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
 * Ensure the Vercel GitHub integration has access to the given org.
 *
 * If not, guides the user through installing the integration in the browser
 * and polls until access is granted.
 */
export async function ensureVercelGitHubAccess(token: string, githubOrg: string): Promise<void> {
  const client = new VercelClient({ token });

  logger.info(`Checking Vercel GitHub access to ${chalk.bold(githubOrg)}...`);
  const hasAccess = await client.hasGitHubAccess(githubOrg);

  if (hasAccess) {
    logger.success(`Vercel has access to ${githubOrg}`);
    return;
  }

  logger.newline();
  logger.warn(`Vercel does not have access to GitHub org: ${githubOrg}`);
  logger.info('');
  logger.info('Vercel needs the GitHub App installed with access to this org.');
  logger.info('');

  // Use the direct GitHub App install URL with pre-selected target
  const installUrl = `https://github.com/apps/vercel/installations/new/permissions?target_id=${encodeURIComponent(githubOrg)}`;
  const fallbackUrl = 'https://vercel.com/integrations/github';

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Open Vercel GitHub integration install page?',
      default: true,
    },
  ]);

  if (proceed) {
    try {
      await open(installUrl);
    } catch {
      logger.warn('Failed to open browser automatically');
    }
    logger.dim(`If browser doesn't open, visit: ${installUrl}`);
    logger.dim(`Or: ${fallbackUrl}`);
    logger.info('');
    logger.info('Steps:');
    logger.info('  1. Select the Vercel team/account to install to');
    logger.info(`  2. Choose "Only select repositories" and pick the ${githubOrg} repo`);
    logger.info('  3. Click "Install"');
    logger.info('');
  }

  // Poll until access is granted (or user gives up)
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const { ready } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'ready',
        message: 'Integration installed and access granted?',
        default: true,
      },
    ]);

    if (!ready) {
      throw new ForjError(
        'Vercel GitHub integration is required. Install at https://vercel.com/integrations/github and try again.',
        'VERCEL_GITHUB_INTEGRATION_REQUIRED'
      );
    }

    logger.info('Re-checking access...');
    const nowHasAccess = await client.hasGitHubAccess(githubOrg);
    if (nowHasAccess) {
      logger.success(`Vercel now has access to ${githubOrg}`);
      return;
    }

    logger.warn(`Still no access to ${githubOrg}. Make sure the Vercel GitHub App is installed and has access to this org.`);
  }

  throw new ForjError(
    `Vercel GitHub integration check timed out after ${maxAttempts} attempts.`,
    'VERCEL_GITHUB_INTEGRATION_TIMEOUT'
  );
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

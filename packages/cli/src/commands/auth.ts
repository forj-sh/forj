/**
 * `forj auth <service>` — update stored API tokens without re-running provisioning
 *
 * Use this when:
 * - A stored token has been rotated and needs to be updated
 * - A stored token was created without sufficient permissions
 * - You want to re-link a service to a different account/team
 *
 * Unlike `forj add <service> --force`, this does NOT re-run provisioning.
 * It only updates the token stored on the Forj server.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../lib/api-client.js';
import { ensureAuthenticated } from '../lib/auth.js';
import { authenticateCloudflare, getCloudflareToken } from '../lib/auth-cloudflare.js';
import { authenticateVercel, getVercelToken } from '../lib/auth-vercel.js';
import { withErrorHandling, ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SUPPORTED_SERVICES = ['cloudflare', 'vercel'] as const;
type AuthService = typeof SUPPORTED_SERVICES[number];

async function reauthCloudflare(): Promise<void> {
  await authenticateCloudflare();
  const token = getCloudflareToken();
  if (!token) {
    throw new ForjError('No Cloudflare token captured', 'AUTH_FAILED');
  }
  await api.post('/auth/cloudflare', { token });
  logger.success('Cloudflare token updated on Forj server');
}

async function reauthVercel(): Promise<void> {
  await authenticateVercel();
  const token = getVercelToken();
  if (!token) {
    throw new ForjError('No Vercel token captured', 'AUTH_FAILED');
  }
  await api.post('/auth/vercel', { token });
  logger.success('Vercel token updated on Forj server');
}

export function createAuthCommand(): Command {
  const command = new Command('auth');

  command
    .description('Update stored API tokens without re-provisioning')
    .argument('<service>', `Service to re-authenticate (${SUPPORTED_SERVICES.join(', ')})`)
    .action(
      withErrorHandling(async (service: string) => {
        if (!SUPPORTED_SERVICES.includes(service as AuthService)) {
          throw new ForjError(
            `Unknown service: ${service}\nSupported: ${SUPPORTED_SERVICES.join(', ')}`,
            'UNKNOWN_SERVICE'
          );
        }

        await ensureAuthenticated();
        logger.log(chalk.bold(`\n✦ Re-authenticate ${service}\n`));

        switch (service as AuthService) {
          case 'cloudflare':
            await reauthCloudflare();
            break;
          case 'vercel':
            await reauthVercel();
            break;
        }

        logger.newline();
        logger.dim('Token has been updated. Existing provisioned services are unaffected.');
      })
    );

  return command;
}

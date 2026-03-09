import { Command } from 'commander';
import { login, getAuthStatus } from '../lib/auth.js';
import { withErrorHandling } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function createLoginCommand(): Command {
  const command = new Command('login');

  command
    .description('Authenticate with Forj')
    .action(
      withErrorHandling(async () => {
        const status = getAuthStatus();

        if (status.authenticated) {
          logger.info('Already authenticated');
          logger.dim(`API URL: ${status.apiUrl}`);
          logger.log('\nRun `forj logout` to sign out');
          return;
        }

        await login();
      })
    );

  return command;
}

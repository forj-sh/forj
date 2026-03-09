import { Command } from 'commander';
import { logout } from '../lib/auth.js';
import { withErrorHandling } from '../utils/errors.js';

export function createLogoutCommand(): Command {
  const command = new Command('logout');

  command
    .description('Sign out and clear local credentials')
    .action(
      withErrorHandling(async () => {
        logout();
      })
    );

  return command;
}

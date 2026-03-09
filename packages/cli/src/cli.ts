import { Command } from 'commander';
import chalk from 'chalk';
import packageJson from '../package.json' with { type: 'json' };
import { createLoginCommand } from './commands/login.js';
import { createLogoutCommand } from './commands/logout.js';

const program = new Command();

program
  .name('forj')
  .description(
    chalk.bold('✦ forj') + ' — Project infrastructure provisioning CLI'
  )
  .version(packageJson.version, '-v, --version', 'Display version number');

// Register commands
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());

// Dev/testing commands - only load if explicitly enabled with FORJ_DEV=1
if (process.env.FORJ_DEV === '1') {
  // Use dynamic import to avoid bundling dev-only code in production
  const { createTestPromptsCommand } = await import('./commands/test-prompts.js');
  program.addCommand(createTestPromptsCommand());
}

// Parse command line arguments
program.parse(process.argv);

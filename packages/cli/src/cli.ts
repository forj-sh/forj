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

// Parse command line arguments
program.parse(process.argv);

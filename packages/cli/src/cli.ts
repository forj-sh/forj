import { Command } from 'commander';
import chalk from 'chalk';
import packageJson from '../package.json' with { type: 'json' };

const program = new Command();

program
  .name('forj')
  .description(
    chalk.bold('✦ forj') + ' — Project infrastructure provisioning CLI'
  )
  .version(packageJson.version, '-v, --version', 'Display version number');

// Parse command line arguments
program.parse(process.argv);

/**
 * Telemetry command
 * Allows users to opt-in or opt-out of anonymous error reporting
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { enableTelemetry, disableTelemetry, isTelemetryEnabled } from '../lib/sentry.js';

export function createTelemetryCommand(): Command {
  const telemetryCommand = new Command('telemetry');

  telemetryCommand
    .description('Manage anonymous error reporting and usage analytics')
    .addCommand(createEnableCommand())
    .addCommand(createDisableCommand())
    .addCommand(createStatusCommand());

  return telemetryCommand;
}

function createEnableCommand(): Command {
  const command = new Command('enable');

  command
    .description('Enable anonymous error reporting')
    .action(async () => {
      console.log(chalk.cyan('\n📊 Forj Telemetry\n'));
      console.log('By enabling telemetry, you help us improve Forj by sharing:');
      console.log('  • Anonymous command usage');
      console.log('  • Error reports (with sensitive data scrubbed)');
      console.log('  • CLI version and platform information');
      console.log('');
      console.log(chalk.bold('What we DO NOT collect:'));
      console.log('  ✗ API keys or credentials');
      console.log('  ✗ Domain names or project details');
      console.log('  ✗ Email addresses or personal information');
      console.log('  ✗ File paths or system usernames');
      console.log('');
      
      enableTelemetry();
      
      console.log('');
      console.log(chalk.dim('You can disable telemetry anytime with:'));
      console.log(chalk.dim('  forj telemetry disable'));
      console.log('');
    });

  return command;
}

function createDisableCommand(): Command {
  const command = new Command('disable');

  command
    .description('Disable anonymous error reporting')
    .action(async () => {
      disableTelemetry();
      console.log('');
      console.log(chalk.dim('You can re-enable telemetry anytime with:'));
      console.log(chalk.dim('  forj telemetry enable'));
      console.log('');
    });

  return command;
}

function createStatusCommand(): Command {
  const command = new Command('status');

  command
    .description('Check telemetry status')
    .action(async () => {
      const enabled = isTelemetryEnabled();
      
      console.log('');
      console.log('Telemetry status:', enabled ? chalk.green('ENABLED') : chalk.red('DISABLED'));
      
      if (!enabled) {
        console.log('');
        console.log(chalk.dim('Enable telemetry to help improve Forj:'));
        console.log(chalk.dim('  forj telemetry enable'));
      }
      
      console.log('');
    });

  return command;
}

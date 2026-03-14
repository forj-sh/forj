import { Command } from 'commander';
import chalk from 'chalk';
import packageJson from '../package.json' with { type: 'json' };
import { initSentry } from './lib/sentry.js';
import { createAddCommand } from './commands/add.js';
import { createDNSCommand } from './commands/dns.js';
import { createInitCommand } from './commands/init.js';
import { createLoginCommand } from './commands/login.js';
import { createLogoutCommand } from './commands/logout.js';
import { createStatusCommand } from './commands/status.js';
import { createTelemetryCommand } from './commands/telemetry.js';

// Initialize Sentry (only if user has opted in)
initSentry();

const program = new Command();

program
  .name('forj')
  .description(
    chalk.bold('✦ forj') + ' — Project infrastructure provisioning CLI'
  )
  .version(packageJson.version, '-v, --version', 'Display version number');

// Register commands
program.addCommand(createInitCommand());
program.addCommand(createStatusCommand());
program.addCommand(createAddCommand());
program.addCommand(createDNSCommand());
program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createTelemetryCommand());

// Dev/testing commands - only load if explicitly enabled with FORJ_DEV=1
if (process.env.FORJ_DEV === '1') {
  // Use dynamic import to avoid bundling dev-only code in production
  const { createTestPromptsCommand } = await import('./commands/test-prompts.js');
  program.addCommand(createTestPromptsCommand());
}

// Parse command line arguments
program.parse(process.argv);

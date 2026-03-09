import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../lib/api-client.js';
import { promptConfirm } from '../lib/prompts.js';
import { streamProvisioningProgress } from '../lib/sse-client.js';
import { readProjectConfig } from '../lib/project.js';
import { withErrorHandling, ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatDuration } from '../utils/formatters.js';

interface AddOptions {
  yes?: boolean;
  json?: boolean;
}

const AVAILABLE_SERVICES = {
  vercel: {
    name: 'Vercel',
    description: 'Vercel project linked to GitHub',
  },
  railway: {
    name: 'Railway',
    description: 'Railway project with optional Postgres',
  },
  'google-workspace': {
    name: 'Google Workspace',
    description: 'Email and productivity suite',
  },
};

type ServiceName = keyof typeof AVAILABLE_SERVICES;

/**
 * Add a service to existing project
 */
async function addService(
  service: ServiceName,
  options: AddOptions
): Promise<void> {
  const config = readProjectConfig();
  const serviceInfo = AVAILABLE_SERVICES[service];

  logger.log(chalk.bold(`\n✦ Add ${serviceInfo.name} to ${config.name}\n`));
  logger.dim(serviceInfo.description);
  logger.newline();

  // Confirm unless --yes
  if (!options.yes) {
    const confirmed = await promptConfirm(
      `Add ${serviceInfo.name} to your project?`
    );

    if (!confirmed) {
      logger.warn('Cancelled');
      return;
    }

    logger.newline();
  }

  // Start provisioning
  const startTime = Date.now();

  await api.post(`/projects/${encodeURIComponent(config.projectId)}/services`, {
    service,
  });

  logger.log(chalk.bold('Provisioning...'));

  const result = await streamProvisioningProgress(
    `/projects/${encodeURIComponent(config.projectId)}/stream?service=${service}`
  );

  const durationMs = Date.now() - startTime;

  logger.newline();
  logger.success(
    `${serviceInfo.name} added successfully in ${formatDuration(durationMs)}`
  );
  logger.dim(`Run ${chalk.cyan('forj status')} to see updated stack.`);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          status: 'complete',
          service,
          result,
          durationMs,
        },
        null,
        2
      )
    );
  }
}

export function createAddCommand(): Command {
  const command = new Command('add');

  command
    .description('Add a service to your project')
    .argument('<service>', `Service to add (${Object.keys(AVAILABLE_SERVICES).join(', ')})`)
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--json', 'Output JSON format')
    .action(
      withErrorHandling(async (service: string, options: AddOptions) => {
        if (!(service in AVAILABLE_SERVICES)) {
          throw new ForjError(
            `Unknown service: ${service}\nAvailable services: ${Object.keys(AVAILABLE_SERVICES).join(', ')}`,
            'INVALID_SERVICE'
          );
        }

        await addService(service as ServiceName, options);
      })
    );

  return command;
}

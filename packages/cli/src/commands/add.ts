import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { api } from '../lib/api-client.js';
import { promptConfirm } from '../lib/prompts.js';
import { streamProvisioningProgress } from '../lib/sse-client.js';
import { readProjectConfig } from '../lib/project.js';
import { ensureAuthenticated } from '../lib/auth.js';
import { authenticateCloudflare, getCloudflareToken } from '../lib/auth-cloudflare.js';
import { promptGitHubOrgSetup } from '../lib/github-org.js';
import { withErrorHandling, ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatDuration } from '../utils/formatters.js';

interface AddOptions {
  yes?: boolean;
  json?: boolean;
  force?: boolean;
}

const AVAILABLE_SERVICES = {
  github: {
    name: 'GitHub',
    description: 'GitHub org + repo for your project',
    requiresAuth: true,
  },
  cloudflare: {
    name: 'Cloudflare',
    description: 'Cloudflare DNS zone for your domain',
    requiresAuth: true,
  },
  vercel: {
    name: 'Vercel',
    description: 'Vercel project linked to GitHub',
    requiresAuth: true,
  },
  railway: {
    name: 'Railway',
    description: 'Railway project with optional Postgres',
    requiresAuth: false,
  },
  'google-workspace': {
    name: 'Google Workspace',
    description: 'Email and productivity suite',
    requiresAuth: false,
  },
};

type ServiceName = keyof typeof AVAILABLE_SERVICES;

interface ServiceStatus {
  status: 'active' | 'pending' | 'failed' | 'not_provisioned';
  value?: string;
  detail?: string;
}

interface ProjectStatus {
  project: string;
  domain: string;
  services: Record<string, ServiceStatus>;
}

/**
 * Check current service status and decide whether to proceed
 */
async function checkServiceStatus(
  projectId: string,
  service: ServiceName,
  force: boolean
): Promise<boolean> {
  try {
    const status = await api.get<ProjectStatus>(
      `/projects/${encodeURIComponent(projectId)}/status`
    );

    const serviceStatus = status.services[service];

    if (serviceStatus?.status === 'active') {
      if (force) {
        logger.warn(`${AVAILABLE_SERVICES[service].name} is already active — re-provisioning with --force`);
        return true;
      }

      logger.success(`${AVAILABLE_SERVICES[service].name} is already active.`);
      if (serviceStatus.value) {
        logger.dim(`  ${serviceStatus.value}`);
      }
      logger.dim(`Use ${chalk.cyan('--force')} to re-provision.`);
      return false;
    }

    if (serviceStatus?.status === 'pending') {
      logger.warn(`${AVAILABLE_SERVICES[service].name} is currently being provisioned.`);
      logger.dim(`Run ${chalk.cyan('forj status')} to check progress.`);
      return false;
    }

    // failed or not_provisioned — proceed
    return true;
  } catch (error) {
    // Status check failed — proceed anyway (API will validate)
    logger.warn(`Could not check service status, proceeding. Error: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

/**
 * Run auth flow for github service
 */
async function runGitHubAuth(projectName: string): Promise<string> {
  const githubOrg = await promptGitHubOrgSetup(projectName);
  logger.newline();
  return githubOrg;
}

/**
 * Run auth flow for cloudflare service
 */
async function runCloudflareAuth(): Promise<void> {
  await authenticateCloudflare();

  // Store token server-side
  const cfToken = getCloudflareToken();
  if (cfToken) {
    await api.post('/auth/cloudflare', { token: cfToken });
  }
  logger.newline();
}

async function runVercelAuth(githubOrg: string): Promise<void> {
  const { authenticateVercel, getVercelToken, ensureVercelGitHubAccess } = await import('../lib/auth-vercel.js');
  const vercelToken = await authenticateVercel();

  // Verify Vercel has GitHub access to the org before proceeding
  await ensureVercelGitHubAccess(vercelToken, githubOrg);

  if (vercelToken) {
    await api.post('/auth/vercel', { token: vercelToken });
  }
  logger.newline();
}

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

  // Ensure authenticated
  await ensureAuthenticated();

  // Check current status
  const shouldProceed = await checkServiceStatus(
    config.projectId,
    service,
    !!options.force
  );

  if (!shouldProceed) {
    return;
  }

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

  // Service-specific auth flows
  let githubOrg: string | undefined;

  if (service === 'github') {
    githubOrg = await runGitHubAuth(config.name);
  } else if (service === 'cloudflare') {
    await runCloudflareAuth();
  } else if (service === 'vercel') {
    // Vercel requires GitHub — fetch current project status and verify it's active.
    const status = await api.get<ProjectStatus>(
      `/projects/${encodeURIComponent(config.projectId)}/status`
    );
    if (!status.services.github || status.services.github.status !== 'active') {
      throw new ForjError(
        'Vercel requires GitHub. Run `forj add github` first.',
        'VERCEL_REQUIRES_GITHUB'
      );
    }
    // Extract github org from the github service value (repo URL or org name)
    const githubValue = status.services.github.value;
    if (githubValue) {
      // Value is either "https://github.com/ORG/REPO" or just "ORG"
      const repoMatch = githubValue.match(/github\.com\/([^/]+)/);
      githubOrg = repoMatch ? repoMatch[1] : githubValue;
    }

    // Fall back to prompting if we couldn't derive the org
    if (!githubOrg) {
      const { org } = await inquirer.prompt([{
        type: 'input',
        name: 'org',
        message: 'GitHub org name (for Vercel repo link):',
        default: config.name,
        validate: (input: string) => input.trim().length > 0 || 'Org name required',
      }]);
      githubOrg = org.trim();
    }

    await runVercelAuth(githubOrg!);
  }

  // Start provisioning
  const startTime = Date.now();

  if (serviceInfo.requiresAuth) {
    // Core services use provision-services endpoint
    await api.post(`/projects/${encodeURIComponent(config.projectId)}/provision-services`, {
      services: [service],
      githubOrg,
    });
  } else {
    // Add-on services use services endpoint
    await api.post(`/projects/${encodeURIComponent(config.projectId)}/services`, {
      service,
    });
  }

  logger.log(chalk.bold('Provisioning...'));

  const sseEndpoint = serviceInfo.requiresAuth
    ? `/events/stream/${encodeURIComponent(config.projectId)}?services=${service}`
    : `/projects/${encodeURIComponent(config.projectId)}/stream?service=${service}`;

  const result = await streamProvisioningProgress(sseEndpoint);

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
    .option('--force', 'Re-provision even if service is already active')
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

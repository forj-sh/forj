import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { api } from '../lib/api-client.js';
import { withErrorHandling, ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatTableRow, formatRelativeTime } from '../utils/formatters.js';

interface StatusOptions {
  json?: boolean;
}

interface ProjectConfig {
  projectId: string;
  name: string;
  domain: string;
}

interface ServiceStatus {
  status: 'active' | 'pending' | 'failed' | 'not_provisioned';
  value?: string;
  detail?: string;
  updatedAt?: string;
}

interface ProjectStatus {
  project: string;
  domain: string;
  services: {
    domain?: ServiceStatus;
    github?: ServiceStatus;
    cloudflare?: ServiceStatus;
    dns?: ServiceStatus;
    vercel?: ServiceStatus;
    railway?: ServiceStatus;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Validate project config shape
 */
function isValidProjectConfig(obj: unknown): obj is ProjectConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const config = obj as Record<string, unknown>;

  return (
    typeof config.projectId === 'string' &&
    config.projectId.length > 0 &&
    typeof config.name === 'string' &&
    typeof config.domain === 'string'
  );
}

/**
 * Read project config from .forj/config.json
 */
function readProjectConfig(): ProjectConfig | null {
  const configPath = join(process.cwd(), '.forj', 'config.json');

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!isValidProjectConfig(parsed)) {
      throw new ForjError(
        'Invalid project config format',
        'INVALID_CONFIG'
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof ForjError) throw error;
    throw new ForjError(
      'Failed to read project config',
      'CONFIG_ERROR',
      error
    );
  }
}

/**
 * Format service status row for display
 */
function formatServiceRow(
  name: string,
  status?: ServiceStatus,
  labelWidth = 15
): string {
  if (!status || status.status === 'not_provisioned') {
    return formatTableRow(name, chalk.dim('–  Not provisioned'), labelWidth);
  }

  let indicator: string;
  let text: string;

  switch (status.status) {
    case 'active':
      indicator = chalk.green('✓');
      text = status.detail || status.value || 'Active';
      break;
    case 'pending':
      indicator = chalk.yellow('◐');
      text = 'Pending';
      break;
    case 'failed':
      indicator = chalk.red('✗');
      text = status.detail || 'Failed';
      break;
    default:
      indicator = chalk.dim('–');
      text = 'Unknown';
  }

  return formatTableRow(name, `${indicator}  ${text}`, labelWidth);
}

/**
 * Display project status in table format
 */
function displayStatus(status: ProjectStatus): void {
  const { project, domain, services, createdAt } = status;

  // Header
  logger.log(chalk.bold(`\n${project} / ${domain}`));
  logger.log('─'.repeat(40));

  // Services - data-driven approach for easier maintenance
  const serviceMap: { key: keyof typeof services; name: string }[] = [
    { key: 'domain', name: 'Domain' },
    { key: 'github', name: 'GitHub' },
    { key: 'cloudflare', name: 'Cloudflare' },
    { key: 'dns', name: 'DNS health' },
    { key: 'vercel', name: 'Vercel' },
    { key: 'railway', name: 'Railway' },
  ];

  for (const { key, name } of serviceMap) {
    logger.log(formatServiceRow(name, services[key]));
  }

  // Footer
  logger.log('─'.repeat(40));
  logger.dim(`Created ${formatRelativeTime(createdAt)}`);
  logger.newline();
}

export function createStatusCommand(): Command {
  const command = new Command('status');

  command
    .description('Show project infrastructure status')
    .option('--json', 'Output JSON format')
    .action(
      withErrorHandling(async (options: StatusOptions) => {
        // Read local project config
        const config = readProjectConfig();

        if (!config) {
          throw new ForjError(
            'No forj project found in current directory.\nRun `forj init` to create a new project.',
            'NO_PROJECT'
          );
        }

        // Fetch status from API
        const spinner = logger.spinner('Fetching project status...');
        spinner.start();

        let status: ProjectStatus;
        try {
          status = await api.get<ProjectStatus>(
            `/projects/${config.projectId}/status`
          );
          spinner.succeed('Status fetched');
        } catch (error) {
          spinner.fail('Failed to fetch status');
          throw error;
        }

        // Display or output
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          displayStatus(status);
        }
      })
    );

  return command;
}

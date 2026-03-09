import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../lib/api-client.js';
import { readProjectConfig } from '../lib/project.js';
import { withErrorHandling } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatTableRow } from '../utils/formatters.js';

interface DNSRecord {
  type: string;
  name: string;
  value: string;
  status: 'valid' | 'invalid' | 'missing';
  error?: string;
}

interface DNSHealthResult {
  domain: string;
  overall: 'healthy' | 'degraded' | 'critical';
  records: DNSRecord[];
  checkedAt: string;
}

/**
 * Format DNS record status
 */
function formatDNSRecord(record: DNSRecord, labelWidth = 15): string {
  const label = `${record.type} (${record.name})`;
  let indicator: string;
  let detail: string;

  switch (record.status) {
    case 'valid':
      indicator = chalk.green('✓');
      detail = record.value;
      break;
    case 'invalid':
      indicator = chalk.yellow('⚠');
      detail = record.error || 'Invalid configuration';
      break;
    case 'missing':
      indicator = chalk.red('✗');
      detail = 'Record not found';
      break;
  }

  return formatTableRow(label, `${indicator}  ${detail}`, labelWidth);
}

/**
 * Check DNS health
 */
async function checkDNS(projectId: string, json?: boolean): Promise<void> {
  const spinner = logger.spinner('Checking DNS records...');
  spinner.start();

  const health = await api.get<DNSHealthResult>(
    `/projects/${encodeURIComponent(projectId)}/dns/health`
  );

  spinner.stop();

  if (json) {
    console.log(JSON.stringify(health, null, 2));
    return;
  }

  // Display results
  logger.log(chalk.bold(`\nDNS Health Check: ${health.domain}`));
  logger.log('─'.repeat(50));

  health.records.forEach((record) => {
    logger.log(formatDNSRecord(record));
  });

  logger.log('─'.repeat(50));

  // Overall status
  let statusText: string;
  switch (health.overall) {
    case 'healthy':
      statusText = chalk.green('✓ All DNS records are healthy');
      break;
    case 'degraded':
      statusText = chalk.yellow('⚠ Some DNS records have issues');
      break;
    case 'critical':
      statusText = chalk.red('✗ Critical DNS configuration errors');
      break;
  }

  logger.log(statusText);
  logger.dim(`Checked at ${new Date(health.checkedAt).toLocaleString()}`);
  logger.newline();

  if (health.overall !== 'healthy') {
    logger.dim(`Run ${chalk.cyan('forj dns fix')} to attempt auto-repair`);
  }
}

/**
 * Attempt to fix DNS issues
 */
async function fixDNS(projectId: string, json?: boolean): Promise<void> {
  const spinner = logger.spinner('Attempting to fix DNS issues...');
  spinner.start();

  const result = await api.post<{
    fixed: string[];
    failed: string[];
  }>(`/projects/${encodeURIComponent(projectId)}/dns/fix`);

  spinner.stop();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  logger.newline();

  if (result.fixed.length > 0) {
    logger.success(`Fixed ${result.fixed.length} DNS record(s):`);
    result.fixed.forEach((record) => {
      logger.log(`  ${chalk.green('✓')} ${record}`);
    });
  }

  if (result.failed.length > 0) {
    logger.error(`Failed to fix ${result.failed.length} record(s):`);
    result.failed.forEach((record) => {
      logger.log(`  ${chalk.red('✗')} ${record}`);
    });
  }

  if (result.fixed.length === 0 && result.failed.length === 0) {
    logger.info('No DNS issues found to fix');
  }

  logger.newline();
  logger.dim(`Run ${chalk.cyan('forj dns check')} to verify`);
}

export function createDNSCommand(): Command {
  const command = new Command('dns');

  command
    .description('Manage DNS records');

  // dns check subcommand
  const checkCommand = new Command('check');
  checkCommand
    .description('Validate DNS record health')
    .option('--json', 'Output JSON format')
    .action(
      withErrorHandling(async (options: { json?: boolean }) => {
        const config = readProjectConfig();
        await checkDNS(config.projectId, options.json);
      })
    );

  // dns fix subcommand
  const fixCommand = new Command('fix');
  fixCommand
    .description('Attempt to auto-repair DNS issues')
    .option('--json', 'Output JSON format')
    .action(
      withErrorHandling(async (options: { json?: boolean }) => {
        const config = readProjectConfig();
        await fixDNS(config.projectId, options.json);
      })
    );

  command.addCommand(checkCommand);
  command.addCommand(fixCommand);

  return command;
}

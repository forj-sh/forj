import { Command } from 'commander';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import {
  promptProjectName,
  promptDomainSelection,
  promptServiceSelection,
  promptGitHubOrgConfirmation,
  promptConfirm,
  DomainOption,
  ServiceOption,
} from '../lib/prompts.js';
import { api } from '../lib/api-client.js';
import { streamProvisioningProgress } from '../lib/sse-client.js';
import { withErrorHandling, ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatDuration } from '../utils/formatters.js';
import {
  generatePhase1,
  generatePhase2,
  getTier,
  sortResults,
  sanitizeName,
  type DomainResult,
} from '../lib/domain-suggestions.js';

interface InitOptions {
  domain?: string;
  services?: string;
  githubOrg?: string;
  nonInteractive?: boolean;
  json?: boolean;
}

interface InitResult {
  project: string;
  domain: string;
  services: Record<string, { status: string; value?: string }>;
  credentialsPath: string;
  durationMs: number;
}

/**
 * Ensure .gitignore includes .forj/
 */
function ensureGitignore(): void {
  const gitignorePath = join(process.cwd(), '.gitignore');
  const forjEntry = '.forj/';

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(forjEntry)) {
      writeFileSync(gitignorePath, `${content}\n${forjEntry}\n`, 'utf-8');
      logger.dim('Added .forj/ to .gitignore');
    }
  } else {
    writeFileSync(gitignorePath, `${forjEntry}\n`, 'utf-8');
    logger.dim('Created .gitignore with .forj/');
  }
}

/** Response shape from the Namecheap /domains/check endpoint */
interface ApiDomainResult {
  domain: string;
  available: boolean;
  isPremium?: boolean;
  price: number;
  retailPrice?: number;
  icannFee?: number;
  registrar?: string;
}

/** Minimum available results before triggering Phase 2 */
const PHASE2_THRESHOLD = 2;

/**
 * Check domain availability via API using two-phase suggestion.
 *
 * Phase 1: exact name on premium TLDs + top .com variants (~7 domains)
 * Phase 2: secondary TLDs + more variants (only if Phase 1 yields <2 available)
 */
async function checkDomainAvailability(
  projectName: string
): Promise<DomainOption[]> {
  const spinner = logger.spinner('Checking domain availability...');
  spinner.start();

  try {
    // Phase 1: high-value candidates
    const phase1Candidates = generatePhase1(projectName);
    if (phase1Candidates.length === 0) {
      spinner.fail('Invalid project name for domain generation');
      return [];
    }

    const phase1Raw = await api.post<{ domains: ApiDomainResult[] }>(
      '/domains/check',
      { domains: phase1Candidates }
    );

    const baseName = sanitizeName(projectName);

    const mapResults = (domains: ApiDomainResult[]): DomainResult[] =>
      (domains || []).map((d) => ({
        name: d.domain,
        price: d.price.toFixed(2),
        available: d.available,
        tier: getTier(d.domain, baseName),
        registrar: d.registrar,
      }));

    let allResults = mapResults(phase1Raw.domains);

    const availableCount = allResults.filter((d) => d.available).length;

    // Phase 2: expand if not enough available
    if (availableCount < PHASE2_THRESHOLD) {
      const phase2Candidates = generatePhase2(projectName);

      if (phase2Candidates.length > 0) {
        spinner.text = 'Expanding search...';

        const phase2Raw = await api.post<{ domains: ApiDomainResult[] }>(
          '/domains/check',
          { domains: phase2Candidates }
        );

        allResults = [...allResults, ...mapResults(phase2Raw.domains)];
      }
    }

    // Sort by tier and availability
    const sorted = sortResults(allResults, baseName);

    spinner.succeed('Domain availability checked');

    // Map to DomainOption for the prompt
    return sorted.map((d) => ({
      name: d.name,
      price: d.price,
      available: d.available,
    }));
  } catch (error) {
    spinner.fail('Failed to check domain availability');
    throw error;
  }
}

/**
 * Interactive init flow
 */
async function interactiveInit(
  projectName?: string,
  options: InitOptions = {}
): Promise<InitResult | null> {
  logger.log(chalk.bold('\n✦ forj 鍛冶場') + ' — project infrastructure provisioning\n');

  // Step 1: Get project name
  const name = projectName || (await promptProjectName());
  logger.newline();

  // Step 2: Domain selection
  let selectedDomain: string;

  if (options.domain) {
    selectedDomain = options.domain;
    logger.info(`Using domain: ${selectedDomain}`);
  } else {
    const domains = await checkDomainAvailability(name);
    selectedDomain = await promptDomainSelection(domains);
  }

  logger.newline();

  // Step 3: Service selection
  const availableServices: ServiceOption[] = [
    {
      id: 'domain',
      name: 'Domain registration',
      description: 'Namecheap reseller',
      enabled: true,
    },
    {
      id: 'github',
      name: 'GitHub org + repos',
      description: `github.com/${name}`,
      enabled: true,
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare zone + DNS wiring',
      description: 'Auto-configured records',
      enabled: true,
    },
    {
      id: 'vercel',
      name: 'Vercel project',
      description: 'Linked to GitHub',
      enabled: false,
    },
  ];

  let selectedServices: string[];

  if (options.services) {
    selectedServices = options.services.split(',');
    logger.info(`Services: ${selectedServices.join(', ')}`);
  } else {
    selectedServices = await promptServiceSelection(availableServices);
  }

  logger.newline();

  // Step 4: GitHub org confirmation (if GitHub selected)
  let githubOrg: string | undefined;

  if (selectedServices.includes('github')) {
    logger.warn('GitHub org must be created manually — takes 15 seconds.');
    logger.dim('Please create the organization on GitHub (URL: https://github.com/organizations/new)');
    logger.newline();

    githubOrg = options.githubOrg || (await promptGitHubOrgConfirmation(name));
    logger.newline();
  }

  // Step 5: Final confirmation
  if (!options.nonInteractive) {
    logger.log(chalk.bold('Summary:'));
    logger.log(`  Project: ${name}`);
    logger.log(`  Domain: ${selectedDomain}`);
    logger.log(`  Services: ${selectedServices.join(', ')}`);
    if (githubOrg) logger.log(`  GitHub org: ${githubOrg}`);
    logger.newline();

    const confirmed = await promptConfirm('Continue with provisioning?');
    if (!confirmed) {
      logger.warn('Provisioning cancelled');
      return null;
    }
    logger.newline();
  }

  // Step 6: Start provisioning
  const startTime = Date.now();

  const result = await api.post<{ projectId: string }>(
    '/projects/init',
    {
      name,
      domain: selectedDomain,
      services: selectedServices,
      githubOrg,
    }
  );

  const { projectId } = result;

  // Step 7: Stream progress via SSE
  logger.log(chalk.bold('Provisioning...'));

  const provisioningResult = await streamProvisioningProgress(
    `/events/stream/${projectId}`
  );

  const durationMs = Date.now() - startTime;

  // Step 8: Save credentials
  const credentialsPath = join(process.cwd(), '.forj', 'credentials.json');
  ensureGitignore();

  logger.newline();
  logger.success(`Credentials → ${credentialsPath} ${chalk.green('(gitignored ✓)')}`);
  logger.newline();
  logger.success(`Setup complete in ${formatDuration(durationMs)}`);
  logger.dim(`Run ${chalk.cyan('forj status')} to see your stack.`);

  return {
    project: name,
    domain: selectedDomain,
    services: (provisioningResult as { services: InitResult['services'] }).services || {},
    credentialsPath,
    durationMs,
  };
}

/**
 * Non-interactive init (for AI agents)
 */
async function nonInteractiveInit(
  projectName: string,
  options: InitOptions
): Promise<InitResult> {
  if (!options.domain) {
    throw new ForjError(
      'Domain is required in non-interactive mode (use --domain)',
      'MISSING_OPTION'
    );
  }

  if (!options.services) {
    throw new ForjError(
      'Services are required in non-interactive mode (use --services)',
      'MISSING_OPTION'
    );
  }

  return interactiveInit(projectName, options);
}

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize project infrastructure')
    .argument('[project-name]', 'Project name (e.g., "acme")')
    .option('--domain <domain>', 'Domain name (e.g., "getacme.com")')
    .option(
      '--services <services>',
      'Comma-separated services (e.g., "github,cloudflare,domain")'
    )
    .option('--github-org <org>', 'GitHub org name (assumes org exists)')
    .option('--non-interactive', 'Skip prompts, use flags only')
    .option('--json', 'Output JSON (implies --non-interactive)')
    .action(
      withErrorHandling(async (projectName: string | undefined, options: InitOptions) => {
        const isNonInteractive = options.nonInteractive || options.json;

        let result: InitResult | null;

        if (isNonInteractive) {
          if (!projectName) {
            throw new ForjError(
              'Project name is required in non-interactive mode',
              'MISSING_ARGUMENT'
            );
          }
          result = await nonInteractiveInit(projectName, options);
        } else {
          result = await interactiveInit(projectName, options);
        }

        // Handle cancellation
        if (!result) {
          process.exit(0);
        }

        // JSON output for agents
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                status: 'complete',
                ...result,
              },
              null,
              2
            )
          );
        }
      })
    );

  return command;
}

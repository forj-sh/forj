import { Command } from 'commander';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import {
  promptProjectName,
  promptDomainSelection,
  promptGitHubOrgConfirmation,
  promptConfirm,
  promptContactInfo,
  promptPostDomainServices,
  DomainOption,
} from '../lib/prompts.js';
import { api } from '../lib/api-client.js';
import { ensureAuthenticated } from '../lib/auth.js';
import { authenticateCloudflare } from '../lib/auth-cloudflare.js';
import { streamProvisioningProgress } from '../lib/sse-client.js';
import { openCheckoutAndWaitForPayment } from '../lib/stripe-checkout.js';
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
  whoisPrivacy?: boolean;
  skipPayment?: boolean;
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
        price: (d.price + (d.icannFee || 0)).toFixed(2),
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
 * Interactive init flow — two-phase: domain purchase first, then services
 */
async function interactiveInit(
  projectName?: string,
  options: InitOptions = {}
): Promise<InitResult | null> {
  logger.log(chalk.bold('\n✦ forj 鍛冶場') + ' — project infrastructure provisioning\n');

  const startTime = Date.now();

  // ════════════════════════════════════════════
  // Phase 1: Domain purchase
  // ════════════════════════════════════════════

  // Step 1: Ensure authenticated
  await ensureAuthenticated();
  logger.newline();

  // Step 2: Company name
  const name = projectName || (await promptProjectName());
  logger.newline();

  // Step 3: Domain selection
  let selectedDomain: string;
  let selectedDomainPrice: string = '?.??';

  if (options.domain) {
    selectedDomain = options.domain;
    logger.info(`Using domain: ${selectedDomain}`);
  } else {
    const domains = await checkDomainAvailability(name);
    selectedDomain = await promptDomainSelection(domains);
    selectedDomainPrice = domains.find((d) => d.name === selectedDomain)?.price || '?.??';
  }
  logger.newline();

  // Step 4: Create project (domain-only, no provisioning yet)
  const { projectId } = await api.post<{ projectId: string }>(
    '/projects/create',
    { name, domain: selectedDomain }
  );

  // Step 5: Contact info
  let contact;
  let useWhoisPrivacy: boolean;

  if (options.nonInteractive) {
    // Non-interactive: require --whois-privacy or error
    if (!options.whoisPrivacy) {
      throw new ForjError(
        'Contact info is required. Use --whois-privacy for WHOIS privacy defaults, or run interactively.',
        'MISSING_OPTION'
      );
    }
    // With --whois-privacy, Namecheap's WhoisGuard replaces all registrant data
    // with proxy contact details in public WHOIS. The registrar requires syntactically
    // valid contact fields but the actual values are never publicly visible.
    // This is standard practice for privacy-protected registrations.
    contact = {
      firstName: 'WHOIS', lastName: 'Agent',
      email: `noreply+${projectId.slice(0, 8)}@forj.sh`,
      phone: '+1.0000000000',
      address1: 'WHOIS Privacy Protection', city: 'Privacy',
      stateProvince: 'CA', postalCode: '00000', country: 'US',
    };
    useWhoisPrivacy = true;
  } else {
    logger.log(chalk.bold('Domain registration requires contact info (ICANN requirement)'));
    logger.dim('With WHOIS privacy enabled, this info stays hidden from public lookups.\n');

    const result = await promptContactInfo();
    contact = result.contact;
    useWhoisPrivacy = result.useWhoisPrivacy;
  }

  await api.post(`/projects/${projectId}/contact-info`, {
    contact,
    useWhoisPrivacy,
  });
  logger.newline();

  // Step 6: Show price and confirm
  logger.log(chalk.bold('Summary:'));
  logger.log(`  Domain: ${selectedDomain}  ${chalk.dim(`$${selectedDomainPrice}/yr`)}`);
  logger.log(`  WHOIS privacy: ${useWhoisPrivacy ? chalk.green('enabled') : 'disabled'}`);
  logger.newline();

  if (!options.nonInteractive) {
    const confirmed = await promptConfirm('Proceed to payment?');
    if (!confirmed) {
      logger.warn('Cancelled');
      return null;
    }
    logger.newline();
  }

  // Step 7: Stripe Checkout — open browser, wait for payment
  if (options.skipPayment) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForjError('--skip-payment is only allowed in non-production environments', 'INVALID_OPTION');
    }
    logger.warn('--skip-payment: bypassing Stripe checkout (dev mode only)');
    await api.post(`/projects/${projectId}/dev/trigger-domain-registration`, {});
  } else {
    const checkout = await api.post<{
      sessionId: string;
      sessionUrl: string;
      expiresAt: number;
    }>('/stripe/create-checkout-session', {
      projectId,
      pricing: { domainName: selectedDomain }, // Server validates pricing
      years: 1,
      isPremium: false,
    });

    await openCheckoutAndWaitForPayment(checkout.sessionUrl, checkout.sessionId);
  }
  logger.newline();

  // Step 8: Wait for domain registration via SSE
  logger.log(chalk.bold('Registering domain...'));

  await streamProvisioningProgress(`/events/stream/${projectId}`);

  logger.newline();
  logger.success(`${chalk.bold(selectedDomain)} is yours!`);
  logger.newline();

  // ════════════════════════════════════════════
  // Phase 2: Additional services
  // ════════════════════════════════════════════

  let selectedServices: string[];

  if (options.services) {
    // Use --services flag (filter out 'domain', already done)
    selectedServices = options.services.split(',').filter((s) => s !== 'domain');
    if (selectedServices.length > 0) {
      logger.info(`Services: ${selectedServices.join(', ')}`);
    }
  } else if (options.nonInteractive) {
    // Non-interactive without --services: skip additional services
    selectedServices = [];
  } else {
    selectedServices = await promptPostDomainServices(selectedDomain, name);
  }

  if (selectedServices.length === 0) {
    logger.dim('No additional services selected.');

    const durationMs = Date.now() - startTime;
    const credentialsPath = join(process.cwd(), '.forj', 'credentials.json');
    ensureGitignore();

    logger.newline();
    logger.success(`Setup complete in ${formatDuration(durationMs)}`);
    logger.dim(`Run ${chalk.cyan('forj status')} to see your stack.`);

    return {
      project: name,
      domain: selectedDomain,
      services: { domain: { status: 'complete' } },
      credentialsPath,
      durationMs,
    };
  }

  logger.newline();

  // GitHub auth (if selected)
  let githubOrg: string | undefined;
  if (selectedServices.includes('github')) {
    logger.warn('GitHub org must be created manually — takes 15 seconds.');
    logger.dim('Please create the organization on GitHub (URL: https://github.com/organizations/new)');
    logger.newline();

    githubOrg = options.githubOrg || (await promptGitHubOrgConfirmation(name));
    logger.newline();
  }

  // Cloudflare token (if DNS selected)
  if (selectedServices.includes('cloudflare')) {
    await authenticateCloudflare();

    // Store token server-side
    const { getCloudflareToken } = await import('../lib/auth-cloudflare.js');
    const cfToken = getCloudflareToken();
    if (cfToken) {
      await api.post('/auth/cloudflare', { token: cfToken });
    }
    logger.newline();
  }

  // Start service provisioning
  await api.post(`/projects/${projectId}/provision-services`, {
    services: selectedServices,
    githubOrg,
  });

  logger.log(chalk.bold('Provisioning services...'));

  const provisioningResult = await streamProvisioningProgress(
    `/events/stream/${projectId}`
  );

  const durationMs = Date.now() - startTime;

  // Save credentials
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

  return interactiveInit(projectName, { ...options, nonInteractive: true }) as Promise<InitResult>;
}

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize project infrastructure')
    .argument('[project-name]', 'Project name (e.g., "acme")')
    .option('--domain <domain>', 'Domain name (e.g., "getacme.com")')
    .option(
      '--services <services>',
      'Comma-separated services (e.g., "github,cloudflare")'
    )
    .option('--github-org <org>', 'GitHub org name (assumes org exists)')
    .option('--whois-privacy', 'Use WHOIS privacy with Forj defaults')
    .option('--skip-payment', 'Skip Stripe checkout (dev mode only)')
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

/**
 * Provisioning orchestrator
 *
 * Coordinates parallel execution of infrastructure provisioning:
 * 1. Domain registration (Namecheap)
 * 2. GitHub repository setup (parallel with Cloudflare)
 * 3. Cloudflare zone creation (parallel with GitHub)
 * 4. Nameserver update (after Cloudflare zone created)
 * 5. DNS record wiring (after nameservers propagated)
 * 6. DNS verification (final step)
 */

import { Queue } from 'bullmq';
import type { Redis as RedisClient } from 'ioredis';
import {
  DomainOperationType,
  DomainJobStatus,
  type RegisterDomainJobData,
  type SetNameserversJobData,
  GitHubOperationType,
  type VerifyOrgJobData,
  type CreateRepoJobData,
  CloudflareOperationType,
  type CreateZoneJobData,
  type VerifyNameserversJobData,
  DNSOperationType,
  type WireDNSRecordsJobData,
  type VerifyDNSRecordsJobData,
  EmailProvider,
  DEFAULT_MX_RECORDS,
  DEFAULT_SPF_RECORDS,
  VercelOperationType,
  type VerifyTeamJobData,
  type CreateProjectJobData,
} from '@forj/shared';

/**
 * Provisioning request configuration
 */
export interface ProvisioningConfig {
  userId: string;
  projectId: string;
  domain: string;
  services: string[]; // Services to provision: 'domain', 'github', 'cloudflare'

  // Service credentials
  namecheapApiUser?: string;
  namecheapApiKey?: string;
  namecheapUsername?: string;
  githubToken?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;

  // Domain registration (only required when services includes 'domain')
  years: number;
  contactInfo?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address1: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
  };

  // GitHub configuration
  githubOrg: string;
  repoName?: string;
  repoDescription?: string;

  // Email configuration
  emailProvider?: EmailProvider;
  customMXRecords?: Array<{ priority: number; value: string }>;
  customSPF?: string;
  dkimSelectors?: string[];

  // Vercel configuration
  vercelTeamId?: string;

  // Optional services
  vercelDomain?: string;
  customCNAMEs?: Array<{ name: string; value: string }>;
}

/**
 * Provisioning job IDs for tracking
 */
export interface ProvisioningJobs {
  domainRegistration?: string;
  nameserverUpdate?: string;
  githubOrgVerify?: string;
  githubRepoCreate?: string;
  cloudflareZone?: string;
  nameserverVerify?: string;
  dnsWiring?: string;
  dnsVerification?: string;
  vercelTeamVerify?: string;
  vercelProjectCreate?: string;
}

/**
 * Orchestrator for parallel provisioning
 */
export class ProvisioningOrchestrator {
  private domainQueue: Queue;
  private githubQueue: Queue;
  private cloudflareQueue: Queue;
  private dnsQueue: Queue;
  private vercelQueue?: Queue;

  constructor(
    domainQueue: Queue,
    githubQueue: Queue,
    cloudflareQueue: Queue,
    dnsQueue: Queue,
    vercelQueue?: Queue,
  ) {
    this.domainQueue = domainQueue;
    this.githubQueue = githubQueue;
    this.cloudflareQueue = cloudflareQueue;
    this.dnsQueue = dnsQueue;
    this.vercelQueue = vercelQueue;
  }

  /**
   * Provision requested infrastructure - fully async, non-blocking
   *
   * IMPORTANT: This method queues only the requested services and returns immediately.
   * Jobs execute asynchronously in background workers. Inter-job dependencies
   * are handled by workers reading job data from completed upstream jobs.
   *
   * Use SSE endpoint /events/stream/:projectId to monitor real-time progress.
   */
  async provision(config: ProvisioningConfig): Promise<ProvisioningJobs> {
    const jobs: ProvisioningJobs = {};
    const { services } = config;

    // Phase 1: Queue domain registration (if requested)
    if (services.includes('domain')) {
      console.log('[Orchestrator] Queueing Phase 1: Domain registration');
      jobs.domainRegistration = await this.registerDomain(config);
    }

    // Phase 2: Queue GitHub and Cloudflare (if requested, will run in parallel by workers)
    const phase2Jobs: [
      Promise<{ orgVerify: string; repoCreate: string } | null>,
      Promise<string | null>
    ] = [
      services.includes('github')
        ? (() => {
            console.log('[Orchestrator] Queueing GitHub setup');
            return this.setupGitHub(config);
          })()
        : Promise.resolve(null),
      services.includes('cloudflare')
        ? (() => {
            console.log('[Orchestrator] Queueing Cloudflare setup');
            return this.setupCloudflare(config);
          })()
        : Promise.resolve(null),
    ];

    const [githubOrgJob, cloudflareZoneJob] = await Promise.all(phase2Jobs);

    if (githubOrgJob) {
      jobs.githubOrgVerify = githubOrgJob.orgVerify;
      jobs.githubRepoCreate = githubOrgJob.repoCreate;
    }
    if (cloudflareZoneJob) {
      jobs.cloudflareZone = cloudflareZoneJob;
    }

    // Queue Vercel (if requested) — depends on GitHub repo existing.
    // Two Vercel jobs are enqueued: VERIFY_TEAM (fast-fail credential precheck)
    // and CREATE_PROJECT. The CREATE_PROJECT handler in the worker explicitly
    // checks the project's github service state in the database and throws a
    // retryable error if not yet `complete`, so BullMQ backoff waits for the
    // GitHub worker to finish. This is a DB-polling dependency gate rather
    // than a FlowProducer parent/child relationship.
    if (services.includes('vercel') && this.vercelQueue) {
      console.log('[Orchestrator] Queueing Vercel setup');
      const vercelJobs = await this.setupVercel(config);
      jobs.vercelTeamVerify = vercelJobs.teamVerify;
      jobs.vercelProjectCreate = vercelJobs.projectCreate;
    }

    // NOTE: Subsequent phases (nameserver update, DNS wiring, verification)
    // are handled by the Cloudflare worker after zone creation completes.
    // The worker will:
    // 1. Create zone
    // 2. Update nameservers on domain via Namecheap API
    // 3. Verify nameserver propagation
    // 4. Queue DNS wiring job
    // 5. Queue DNS verification job
    //
    // This allows the HTTP request to return immediately while work continues
    // in background. Users monitor progress via SSE stream.

    console.log('[Orchestrator] All jobs queued successfully - provisioning running in background');
    return jobs;
  }

  /**
   * Register domain with Namecheap
   */
  private async registerDomain(config: ProvisioningConfig): Promise<string> {
    if (!config.contactInfo) {
      throw new Error('contactInfo is required for domain registration');
    }
    const contactInfo = config.contactInfo;

    const jobData: RegisterDomainJobData = {
      jobId: '', // Placeholder - BullMQ will assign actual job ID
      operation: DomainOperationType.REGISTER,
      userId: config.userId,
      projectId: config.projectId,
      status: 'pending' as any, // Will be updated by worker
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      domainName: config.domain,
      years: config.years,
      // Use the same contact info for all roles (standard for small teams)
      // Map 'email' to 'emailAddress' for Namecheap API
      registrant: { ...contactInfo, emailAddress: contactInfo.email },
      tech: { ...contactInfo, emailAddress: contactInfo.email },
      admin: { ...contactInfo, emailAddress: contactInfo.email },
      auxBilling: { ...contactInfo, emailAddress: contactInfo.email },
      // WhoisGuard settings (enabled by default for privacy)
      addFreeWhoisguard: true,
      wgEnabled: true,
      isPremiumDomain: false, // Will be checked during registration
    };

    const job = await this.domainQueue.add('register-domain', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    return job.id!;
  }

  /**
   * Setup GitHub organization and repository
   *
   * BREAKING CHANGE (Stack 4): Credentials removed from job data
   * - accessToken no longer passed in GitHub job payloads
   * - Workers MUST be updated to fetch encrypted credentials from database
   * - This change prevents credential exposure in Redis but breaks current workers
   */
  private async setupGitHub(config: ProvisioningConfig): Promise<{
    orgVerify: string;
    repoCreate: string;
  }> {
    // Verify org exists
    const orgJobData: VerifyOrgJobData = {
      operation: GitHubOperationType.VERIFY_ORG,
      userId: config.userId,
      projectId: config.projectId,
      orgName: config.githubOrg,
    };

    const orgJob = await this.githubQueue.add('verify-org', orgJobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    // Create repository (GitHub worker will handle dependency on org verification)
    const repoJobData: CreateRepoJobData = {
      operation: GitHubOperationType.CREATE_REPO,
      userId: config.userId,
      projectId: config.projectId,
      orgName: config.githubOrg,
      repoName: config.repoName || config.domain.split('.')[0],
      repoDescription: config.repoDescription || `Repository for ${config.domain}`,
      isPrivate: false,
    };

    const repoJob = await this.githubQueue.add('create-repo', repoJobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    return {
      orgVerify: orgJob.id!,
      repoCreate: repoJob.id!,
    };
  }

  /**
   * Setup Cloudflare DNS zone
   *
   * BREAKING CHANGE (Stack 4): Credentials removed from job data
   * - apiToken no longer passed in Cloudflare job payloads
   * - Workers MUST be updated to fetch encrypted credentials from database
   * - This change prevents credential exposure in Redis but breaks current workers
   */
  private async setupCloudflare(config: ProvisioningConfig): Promise<string> {
    const jobData: CreateZoneJobData = {
      operation: CloudflareOperationType.CREATE_ZONE,
      userId: config.userId,
      projectId: config.projectId,
      domain: config.domain,
      accountId: config.cloudflareAccountId,
    };

    const job = await this.cloudflareQueue.add('create-zone', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    return job.id!;
  }

  /**
   * Setup Vercel project with GitHub repo link and custom domain
   *
   * Queues two jobs:
   *   1. verify-team — fast-fail credential precheck (independent of GitHub state)
   *   2. create-project — waits for GitHub repo to exist via a DB check in the
   *      worker (retryable error + BullMQ backoff). Once the repo is ready, the
   *      worker links Vercel to it and chains to configure-domain internally.
   *
   * Note: verify-team and create-project are intentionally independent jobs.
   * create-project does its own credential fetch so verify-team is redundant
   * for correctness but provides earlier user-facing feedback on bad tokens.
   */
  private async setupVercel(config: ProvisioningConfig): Promise<{
    teamVerify: string;
    projectCreate: string;
  }> {
    const teamJobData: VerifyTeamJobData = {
      operation: VercelOperationType.VERIFY_TEAM,
      userId: config.userId,
      projectId: config.projectId,
      domain: config.domain,
      teamId: config.vercelTeamId,
    };

    const teamJob = await this.vercelQueue!.add('verify-team', teamJobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    const projectJobData: CreateProjectJobData = {
      operation: VercelOperationType.CREATE_PROJECT,
      userId: config.userId,
      projectId: config.projectId,
      domain: config.domain,
      teamId: config.vercelTeamId,
      githubOrg: config.githubOrg,
      repoName: config.repoName || config.domain.split('.')[0],
    };

    // create-project depends on the GitHub repo existing. The worker uses a
    // DB check + retryable error as a dependency gate, so budget generous
    // retries to cover typical GitHub provisioning time (~30–120s).
    // 10 attempts × exponential backoff (2s, 4s, 8s, ... capped) ≈ 17 min total.
    const projectJob = await this.vercelQueue!.add('create-project', projectJobData, {
      attempts: 10,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    return {
      teamVerify: teamJob.id!,
      projectCreate: projectJob.id!,
    };
  }

  /**
   * Update domain nameservers to Cloudflare
   */
  private async updateNameservers(
    config: ProvisioningConfig,
    nameservers: string[]
  ): Promise<string> {
    // Generate deterministic job ID for idempotency
    const jobId = `set-nameservers:${config.projectId}:${Date.now()}`;

    const jobData: SetNameserversJobData = {
      jobId,
      operation: DomainOperationType.SET_NAMESERVERS,
      userId: config.userId,
      projectId: config.projectId,
      status: DomainJobStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
      domainName: config.domain,
      nameservers,
      // BREAKING CHANGE (PR #85): Credentials removed from job data
      // Worker will fetch Namecheap API credentials from environment variables
    };

    const job = await this.domainQueue.add('set-nameservers', jobData, {
      jobId, // Use consistent jobId for idempotency
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    return job.id!;
  }

  /**
   * Verify nameserver propagation
   *
   * BREAKING CHANGE (Stack 4): Credentials removed from job data
   * - apiToken no longer passed in Cloudflare job payloads
   * - Workers MUST be updated to fetch encrypted credentials from database
   * - This change prevents credential exposure in Redis but breaks current workers
   */
  private async verifyNameservers(
    config: ProvisioningConfig,
    zoneId: string,
    nameservers: string[]
  ): Promise<string> {
    const jobData: VerifyNameserversJobData = {
      operation: CloudflareOperationType.VERIFY_NAMESERVERS,
      userId: config.userId,
      projectId: config.projectId,
      domain: config.domain,
      zoneId,
      expectedNameservers: nameservers,
    };

    const job = await this.cloudflareQueue.add('verify-nameservers', jobData, {
      attempts: 10, // DNS propagation can take time
      backoff: {
        type: 'exponential',
        delay: 30000, // Start at 30 seconds
      },
    });

    return job.id!;
  }

  /**
   * Wire DNS records (MX, SPF, DKIM, DMARC, CNAME)
   *
   * BREAKING CHANGE (Stack 4): Credentials removed from job data
   * - cloudflareApiToken no longer passed in DNS job payloads
   * - Workers MUST be updated to fetch encrypted credentials from database
   * - This change prevents credential exposure in Redis but breaks current workers
   */
  private async wireDNS(config: ProvisioningConfig, zoneId: string): Promise<string> {
    const jobData: WireDNSRecordsJobData = {
      operation: DNSOperationType.WIRE_RECORDS,
      userId: config.userId,
      projectId: config.projectId,
      domain: config.domain,
      zoneId,
      emailProvider: config.emailProvider || EmailProvider.GOOGLE_WORKSPACE,
      customMXRecords: config.customMXRecords,
      customSPF: config.customSPF,
      dkimSelectors: config.dkimSelectors,
      githubOrg: config.githubOrg,
      vercelDomain: config.vercelDomain,
      customCNAMEs: config.customCNAMEs,
    };

    const job = await this.dnsQueue.add('wire-dns', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    return job.id!;
  }

  /**
   * Verify DNS record propagation
   *
   * BREAKING CHANGE (Stack 4): Credentials removed from job data
   * - cloudflareApiToken no longer passed in DNS job payloads
   * - Workers MUST be updated to fetch encrypted credentials from database
   * - This change prevents credential exposure in Redis but breaks current workers
   */
  private async verifyDNS(config: ProvisioningConfig, zoneId: string): Promise<string> {
    // Build expected records based on configuration
    const expectedRecords = [];

    // MX records - use defaults from shared constants
    if (config.emailProvider) {
      const mxRecords =
        config.customMXRecords ||
        (config.emailProvider in DEFAULT_MX_RECORDS
          ? DEFAULT_MX_RECORDS[config.emailProvider as keyof typeof DEFAULT_MX_RECORDS]
          : undefined);
      if (mxRecords && mxRecords.length > 0) {
        // Verify first MX record exists
        expectedRecords.push({
          type: 'MX',
          name: config.domain,
          content: mxRecords[0].value,
        });
      }
    }

    // SPF record - use defaults from shared constants
    if (config.emailProvider) {
      const spfRecord =
        config.customSPF ||
        (config.emailProvider in DEFAULT_SPF_RECORDS
          ? DEFAULT_SPF_RECORDS[config.emailProvider as keyof typeof DEFAULT_SPF_RECORDS]
          : undefined);
      if (spfRecord) {
        expectedRecords.push({
          type: 'TXT',
          name: config.domain,
          content: spfRecord,
        });
      }
    }

    // GitHub Pages CNAME
    if (config.githubOrg) {
      expectedRecords.push({
        type: 'CNAME',
        name: `www.${config.domain}`,
        content: `${config.githubOrg}.github.io`,
      });
    }

    const jobData: VerifyDNSRecordsJobData = {
      operation: DNSOperationType.VERIFY_RECORDS,
      userId: config.userId,
      projectId: config.projectId,
      domain: config.domain,
      zoneId,
      expectedRecords,
    };

    const job = await this.dnsQueue.add('verify-dns', jobData, {
      attempts: 10, // DNS propagation can take time
      backoff: {
        type: 'exponential',
        delay: 60000, // Start at 1 minute
      },
    });

    return job.id!;
  }

  /**
   * Wait for a job to complete
   */
  private async waitForJob(queue: Queue, jobId: string): Promise<any> {
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Poll for completion
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      const state = await job.getState();

      if (state === 'completed') {
        return job.returnvalue;
      }

      if (state === 'failed') {
        const failedReason = job.failedReason || 'Unknown error';
        throw new Error(`Job ${jobId} failed: ${failedReason}`);
      }

      // Wait 5 seconds before next check
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error(`Job ${jobId} timed out after ${maxAttempts * 5} seconds`);
  }
}

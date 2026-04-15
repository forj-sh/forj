/**
 * Vercel worker - BullMQ job handlers for Vercel operations
 *
 * Handles:
 * - Team verification
 * - Project creation (with GitHub repo link)
 * - Custom domain configuration (with Cloudflare DNS record creation)
 *
 * Dependencies:
 * - GitHub repo must exist before project creation. This worker enforces the
 *   dependency by checking the project's `github` service state in the database
 *   at the start of CREATE_PROJECT and throwing a retryable Error if it is not
 *   yet `complete`. BullMQ backoff then waits for the GitHub worker to finish.
 * - Cloudflare zone must exist before domain configuration (for DNS record creation)
 */

import { Worker, Job, Queue, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import {
  VercelClient,
  VercelApiError,
  VercelErrorCategory,
  CloudflareClient,
  CloudflareApiError,
  type VercelJobData,
  type VercelWorkerConfig,
  type VercelWorkerEvent,
  type IVercelWorkerEventPublisher,
  type VerifyTeamJobData,
  type CreateProjectJobData,
  type ConfigureDomainJobData,
  VercelOperationType,
  VercelJobStatus,
  VercelWorkerEventType,
  isValidVercelStateTransition,
  VERCEL_CNAME_TARGET,
  VERCEL_A_RECORDS,
  WORKER_LOCK_DURATION,
  WORKER_LOCK_RENEW_TIME,
} from '@forj/shared';
import { updateProjectService, fetchUserCredentials, fetchProjectServiceState } from './database.js';

/**
 * Vercel worker class
 */
export class VercelWorker {
  private worker: Worker<VercelJobData>;
  private redis: Redis;
  private eventPublisher?: IVercelWorkerEventPublisher;
  private vercelQueue: Queue;

  constructor(config: VercelWorkerConfig) {
    this.redis = new Redis(config.redis);
    this.eventPublisher = config.eventPublisher;

    this.worker = new Worker<VercelJobData>(
      'vercel',
      async (job) => this.processJob(job),
      {
        connection: config.redis,
        concurrency: config.concurrency || 3,
        lockDuration: WORKER_LOCK_DURATION,
        lockRenewTime: WORKER_LOCK_RENEW_TIME,
      }
    );

    this.vercelQueue = new Queue('vercel', {
      connection: config.redis,
    });

    this.setupEventHandlers();
  }

  /**
   * Set up worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`Vercel job ${job.id} completed`);

      // Mark service as 'complete' in DB when the terminal operation finishes.
      // The workflow is VERIFY_TEAM → CREATE_PROJECT → CONFIGURE_DOMAIN.
      // CONFIGURE_DOMAIN is the final step; CREATE_PROJECT is also terminal
      // if domain configuration is not requested.
      const progress = job.progress as { status?: VercelJobStatus };

      if (progress?.status === VercelJobStatus.COMPLETE) {
        const vercelProjectId = 'vercelProjectId' in job.data ? job.data.vercelProjectId : undefined;
        const now = new Date().toISOString();

        void updateProjectService(job.data.projectId, 'vercel', {
          status: 'complete',
          value: vercelProjectId as string | undefined,
          updatedAt: now,
          completedAt: now,
        }).catch((err) => {
          console.error('Failed to update project status in database:', err);
        });
      }
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Vercel job ${job?.id} failed:`, err.message);

      if (job) {
        const errorMessage = err instanceof VercelApiError ? err.getUserMessage() : err.message;

        void updateProjectService(job.data.projectId, 'vercel', {
          status: 'failed',
          error: errorMessage,
          updatedAt: new Date().toISOString(),
        }).catch((dbErr) => {
          console.error('Failed to update project status in database:', dbErr);
        });
      }
    });

    this.worker.on('error', (err) => {
      console.error('Vercel worker error:', err);
    });
  }

  /**
   * Process Vercel job based on operation type
   */
  private async processJob(job: Job<VercelJobData>): Promise<void> {
    const { operation } = job.data;

    switch (operation) {
      case VercelOperationType.VERIFY_TEAM:
        return this.handleVerifyTeam(job as Job<VerifyTeamJobData>);
      case VercelOperationType.CREATE_PROJECT:
        return this.handleCreateProject(job as Job<CreateProjectJobData>);
      case VercelOperationType.CONFIGURE_DOMAIN:
        return this.handleConfigureDomain(job as Job<ConfigureDomainJobData>);
      default:
        throw new Error(`Unknown Vercel operation: ${operation}`);
    }
  }

  /**
   * Handle team verification
   */
  private async handleVerifyTeam(job: Job<VerifyTeamJobData>): Promise<void> {
    const { userId, projectId, teamId } = job.data;

    let currentState = VercelJobStatus.QUEUED;

    await this.updateJobState(job, currentState, VercelJobStatus.VERIFYING_TEAM);
    currentState = VercelJobStatus.VERIFYING_TEAM;
    await this.publishEvent({
      type: VercelWorkerEventType.TEAM_VERIFICATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: { teamId, status: VercelJobStatus.VERIFYING_TEAM },
    });

    try {
      const credentials = await fetchUserCredentials(userId);
      if (!credentials?.vercelApiToken) {
        throw new VercelApiError(
          401,
          { code: 'missing_credentials', message: `Vercel credentials not found for user ${userId}` },
          VercelErrorCategory.AUTH,
        );
      }

      const client = new VercelClient({
        token: credentials.vercelApiToken,
        teamId: credentials.vercelTeamId || teamId,
      });

      // Verify token works by getting user info
      const user = await client.getUser();

      // Verify team access if teamId is specified
      if (credentials.vercelTeamId || teamId) {
        const effectiveTeamId = credentials.vercelTeamId || teamId!;
        await client.getTeam(effectiveTeamId);
        console.log(`✅ Vercel team ${effectiveTeamId} verified for user ${user.username}`);
      } else {
        console.log(`✅ Vercel personal account verified for user ${user.username}`);
      }

      await this.updateJobState(job, currentState, VercelJobStatus.TEAM_VERIFIED);
      await this.publishEvent({
        type: VercelWorkerEventType.TEAM_VERIFICATION_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { teamId: credentials.vercelTeamId || teamId, status: VercelJobStatus.TEAM_VERIFIED },
      });
    } catch (error) {
      const apiError = error instanceof VercelApiError
        ? error
        : new VercelApiError(0, { code: 'UNKNOWN', message: (error as Error).message }, VercelErrorCategory.UNKNOWN);
      await this.handleJobError(job, currentState, apiError, VercelWorkerEventType.TEAM_VERIFICATION_FAILED);
    }
  }

  /**
   * Handle project creation with GitHub repo link
   */
  private async handleCreateProject(job: Job<CreateProjectJobData>): Promise<void> {
    const { userId, projectId, domain, githubOrg, repoName, teamId } = job.data;

    // Dependency gate: GitHub repo must exist before we can link Vercel to it.
    // Throw a retryable Error (not UnrecoverableError) so BullMQ backoff waits
    // for the GitHub worker to finish. Attempts + exponential backoff on the
    // create-project job are sized to cover typical GitHub provisioning time.
    const githubState = await fetchProjectServiceState(projectId, 'github');
    if (!githubState || githubState.status !== 'complete') {
      const actual = githubState?.status ?? 'not_provisioned';
      throw new Error(
        `Vercel create-project waiting for GitHub repo (current status: ${actual})`
      );
    }

    let currentState = VercelJobStatus.TEAM_VERIFIED;

    await this.updateJobState(job, currentState, VercelJobStatus.CREATING_PROJECT);
    currentState = VercelJobStatus.CREATING_PROJECT;
    await this.publishEvent({
      type: VercelWorkerEventType.PROJECT_CREATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: { domain, githubOrg, repoName, status: VercelJobStatus.CREATING_PROJECT },
    });

    try {
      const credentials = await fetchUserCredentials(userId);
      if (!credentials?.vercelApiToken) {
        throw new VercelApiError(
          401,
          { code: 'missing_credentials', message: `Vercel credentials not found for user ${userId}` },
          VercelErrorCategory.AUTH,
        );
      }

      const client = new VercelClient({
        token: credentials.vercelApiToken,
        teamId: credentials.vercelTeamId || teamId,
      });

      // Project name derived from domain — use full domain with dots replaced by hyphens
      // to avoid collisions (e.g., app.example.com and app.test.com)
      const projectName = domain.replace(/\./g, '-');

      let vercelProject;
      try {
        vercelProject = await client.createProject({
          name: projectName,
          gitRepository: {
            type: 'github',
            repo: `${githubOrg}/${repoName}`,
          },
        });
      } catch (createError) {
        // If project already exists (409), consider it idempotent
        if (createError instanceof VercelApiError && createError.category === VercelErrorCategory.CONFLICT) {
          console.log(`Vercel project already exists for ${domain}, fetching existing...`);
          const existing = await client.getProject(projectName);
          await this.handleProjectCreationSuccess(job, currentState, existing.id, true);
          return;
        }
        throw createError;
      }

      await this.handleProjectCreationSuccess(job, currentState, vercelProject.id, false);
    } catch (error) {
      const apiError = error instanceof VercelApiError
        ? error
        : new VercelApiError(0, { code: 'UNKNOWN', message: (error as Error).message }, VercelErrorCategory.UNKNOWN);
      await this.handleJobError(job, currentState, apiError, VercelWorkerEventType.PROJECT_CREATION_FAILED);
    }
  }

  /**
   * Handle successful project creation
   */
  private async handleProjectCreationSuccess(
    job: Job<CreateProjectJobData>,
    currentState: VercelJobStatus,
    vercelProjectId: string,
    alreadyExisted: boolean,
  ): Promise<void> {
    const { userId, projectId, domain } = job.data;

    await this.updateJobState(job, currentState, VercelJobStatus.PROJECT_CREATED);

    await this.publishEvent({
      type: VercelWorkerEventType.PROJECT_CREATION_COMPLETE,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        domain,
        vercelProjectId,
        status: VercelJobStatus.PROJECT_CREATED,
        ...(alreadyExisted && { alreadyExisted: true }),
      },
    });

    // Auto-queue domain configuration job
    await this.queueDomainConfiguration({
      userId,
      projectId,
      domain,
      teamId: job.data.teamId,
      vercelProjectId,
    });
  }

  /**
   * Handle domain configuration
   *
   * 1. Add domain to Vercel project
   * 2. Create DNS records in Cloudflare (CNAME → cname.vercel-dns.com)
   * 3. Mark as complete (verification happens asynchronously on Vercel's side)
   */
  private async handleConfigureDomain(job: Job<ConfigureDomainJobData>): Promise<void> {
    const { userId, projectId, domain, vercelProjectId, teamId, cloudflareZoneId } = job.data;

    let currentState = VercelJobStatus.PROJECT_CREATED;

    await this.updateJobState(job, currentState, VercelJobStatus.CONFIGURING_DOMAIN);
    currentState = VercelJobStatus.CONFIGURING_DOMAIN;
    await this.publishEvent({
      type: VercelWorkerEventType.DOMAIN_CONFIGURATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: { domain, vercelProjectId, status: VercelJobStatus.CONFIGURING_DOMAIN },
    });

    try {
      const credentials = await fetchUserCredentials(userId);
      if (!credentials?.vercelApiToken) {
        throw new VercelApiError(
          401,
          { code: 'missing_credentials', message: `Vercel credentials not found for user ${userId}` },
          VercelErrorCategory.AUTH,
        );
      }

      const vercelClient = new VercelClient({
        token: credentials.vercelApiToken,
        teamId: credentials.vercelTeamId || teamId,
      });

      // Add domain to Vercel project
      let domainResult;
      try {
        domainResult = await vercelClient.addDomain(vercelProjectId, domain);
      } catch (error) {
        // 409 = domain already added, which is fine (idempotent)
        if (error instanceof VercelApiError && error.category === VercelErrorCategory.CONFLICT) {
          console.log(`Domain ${domain} already added to Vercel project, continuing...`);
          const domains = await vercelClient.getDomains(vercelProjectId);
          domainResult = domains.find(d => d.name === domain);
          if (!domainResult) {
            throw new Error(`Domain ${domain} reported as existing but not found on project`);
          }
        } else {
          throw error;
        }
      }

      console.log(`✅ Domain ${domain} added to Vercel project ${vercelProjectId}`);

      // Create CNAME record in Cloudflare if we have Cloudflare credentials
      if (credentials.cloudflareApiToken && credentials.cloudflareAccountId) {
        const cfClient = new CloudflareClient({
          apiToken: credentials.cloudflareApiToken,
          accountId: credentials.cloudflareAccountId,
        });

        // Determine zone ID — use provided or look up by domain
        // Look up Cloudflare zone by apex domain (subdomain lookups would fail)
        let zoneId = cloudflareZoneId;
        if (!zoneId) {
          const apexName = domainResult.apexName;
          const zones = await cfClient.listZones(credentials.cloudflareAccountId, apexName);
          const zone = zones.find(z => z.name === apexName);
          if (zone) {
            zoneId = zone.id;
          }
        }

        if (zoneId) {
          // Create CNAME record pointing to Vercel
          try {
            // Apex domains use A record; subdomains use CNAME (standard DNS best practice)
            const isApex = domainResult.name === domainResult.apexName;
            if (isApex) {
              await cfClient.createDNSRecord(zoneId, {
                type: 'A',
                name: domain,
                content: VERCEL_A_RECORDS[0],
                proxied: false,
                comment: 'Created by Forj - Vercel apex deployment',
              });
            } else {
              await cfClient.createDNSRecord(zoneId, {
                type: 'CNAME',
                name: domain,
                content: VERCEL_CNAME_TARGET,
                proxied: false,
                comment: 'Created by Forj - Vercel subdomain deployment',
              });
            }
            console.log(`✅ DNS record created in Cloudflare for ${domain}`);
          } catch (dnsError) {
            // Only ignore "record already exists" (Cloudflare error code 81057)
            if (dnsError instanceof CloudflareApiError && dnsError.errors.some((e: { code: number }) => e.code === 81057)) {
              console.warn(`DNS record for ${domain} already exists, continuing.`);
            } else {
              throw dnsError;
            }
          }
        } else {
          console.warn(`No Cloudflare zone found for ${domain} — DNS records must be added manually`);
        }
      }

      // Mark as complete — Vercel verifies domain asynchronously
      await this.updateJobState(job, currentState, VercelJobStatus.COMPLETE);
      await this.publishEvent({
        type: VercelWorkerEventType.DOMAIN_CONFIGURATION_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: {
          domain,
          vercelProjectId,
          verified: domainResult.verified,
          status: VercelJobStatus.COMPLETE,
        },
      });
    } catch (error) {
      const apiError = error instanceof VercelApiError
        ? error
        : new VercelApiError(0, { code: 'UNKNOWN', message: (error as Error).message }, VercelErrorCategory.UNKNOWN);
      await this.handleJobError(job, currentState, apiError, VercelWorkerEventType.DOMAIN_CONFIGURATION_FAILED);
    }
  }

  /**
   * Queue domain configuration job
   */
  private async queueDomainConfiguration(data: {
    userId: string;
    projectId: string;
    domain: string;
    teamId?: string;
    vercelProjectId: string;
  }): Promise<void> {
    const jobData: ConfigureDomainJobData = {
      operation: VercelOperationType.CONFIGURE_DOMAIN,
      userId: data.userId,
      projectId: data.projectId,
      domain: data.domain,
      teamId: data.teamId,
      vercelProjectId: data.vercelProjectId,
    };

    await this.vercelQueue.add('configure-domain', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    console.log(`✅ Queued domain configuration job for ${data.domain} (project: ${data.vercelProjectId})`);
  }

  /**
   * Update job state with validation
   */
  private async updateJobState(
    job: Job<VercelJobData>,
    currentState: VercelJobStatus,
    newState: VercelJobStatus,
  ): Promise<void> {
    if (!isValidVercelStateTransition(currentState, newState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
    }
    await job.updateProgress({ status: newState });
  }

  /**
   * Handle job error
   */
  private async handleJobError(
    job: Job<VercelJobData>,
    currentState: VercelJobStatus,
    error: VercelApiError,
    eventType: VercelWorkerEventType,
  ): Promise<void> {
    const { userId, projectId, domain } = job.data;

    await this.updateJobState(job, currentState, VercelJobStatus.FAILED);
    await this.publishEvent({
      type: eventType,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        domain,
        error: error.message,
        errorCategory: error.category,
        status: VercelJobStatus.FAILED,
      },
    });

    if (error.isRetryable()) {
      throw error; // Let BullMQ retry
    } else {
      throw new UnrecoverableError(error.message);
    }
  }

  /**
   * Publish event to Redis pub/sub
   */
  private async publishEvent(event: VercelWorkerEvent): Promise<void> {
    if (this.eventPublisher) {
      await this.eventPublisher.publishEvent(event);
    } else {
      await this.redis.publish(`worker:events:${event.projectId}`, JSON.stringify(event));
    }
  }

  /**
   * Close worker, queue, and Redis connection
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.vercelQueue.close();
    await this.redis.quit();
  }
}

/**
 * DNS wiring worker - BullMQ job handlers for DNS record provisioning
 *
 * Handles:
 * - MX record creation (Google Workspace, Microsoft 365, custom)
 * - SPF record creation
 * - DKIM record creation (Google Workspace)
 * - DMARC record creation
 * - CNAME record creation (GitHub Pages, Vercel, custom)
 * - DNS record verification
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { promises as dns } from 'dns';
import {
  CloudflareClient,
  CloudflareApiError,
  CloudflareErrorCategory,
  type DNSJobData,
  type DNSWorkerConfig,
  type DNSWorkerEvent,
  type WireDNSRecordsJobData,
  type VerifyDNSRecordsJobData,
  DNSOperationType,
  DNSJobStatus,
  EmailProvider,
  DNSWorkerEventType,
  isValidDNSStateTransition,
  DEFAULT_MX_RECORDS,
  DEFAULT_SPF_RECORDS,
  DEFAULT_DMARC_RECORD,
  WORKER_LOCK_DURATION,
  WORKER_LOCK_RENEW_TIME,
} from '@forj/shared';
import { updateProjectService, fetchUserCredentials } from './database.js';

/**
 * DNS wiring worker class
 */
export class DNSWorker {
  private worker: Worker<DNSJobData>;
  private redis: Redis;
  private eventPublisher?: DNSWorkerConfig['eventPublisher'];

  constructor(config: DNSWorkerConfig) {
    this.redis = new Redis(config.redis);
    this.eventPublisher = config.eventPublisher;

    this.worker = new Worker<DNSJobData>(
      'dns',
      async (job) => this.processJob(job),
      {
        connection: config.redis,
        concurrency: config.concurrency || 3,
        // Lock configuration to prevent "Missing lock" errors
        // See packages/shared/src/worker-config.ts for default values
        lockDuration: WORKER_LOCK_DURATION,
        lockRenewTime: WORKER_LOCK_RENEW_TIME,
      }
    );

    this.setupEventHandlers();
  }

  /**
   * Set up worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`DNS job ${job.id} completed`);

      // Only mark service as 'complete' in DB if it's the terminal operation.
      // DNS jobs are multi-step (WIRE_RECORDS → VERIFY_RECORDS), and the 'completed'
      // event fires for each operation. We only want to mark the service complete when
      // DNS verification finishes successfully with DNSJobStatus.COMPLETE status.
      const progress = job.progress as { status?: DNSJobStatus };

      if (progress?.status === DNSJobStatus.COMPLETE) {
        const value = job.data.domain;
        const now = new Date().toISOString();

        void updateProjectService(job.data.projectId, 'dns', {
          status: 'complete',
          value,
          updatedAt: now,
          completedAt: now,
        }).catch((err) => {
          console.error('Failed to update project status in database:', err);
        });
      }
    });

    this.worker.on('failed', (job, err) => {
      console.error(`DNS job ${job?.id} failed:`, err);

      if (job) {
        // Use user-friendly error message from CloudflareApiError if available
        const errorMessage = err instanceof CloudflareApiError ? err.message : err.message;
        const now = new Date().toISOString();

        // Update database with failure status
        void updateProjectService(job.data.projectId, 'dns', {
          status: 'failed',
          error: errorMessage,
          updatedAt: now,
          completedAt: now,
        }).catch((dbErr) => {
          console.error('Failed to update project status in database:', dbErr);
        });
      }
    });

    this.worker.on('error', (err) => {
      console.error('DNS worker error:', err);
    });
  }

  /**
   * Process DNS job based on operation type
   */
  private async processJob(job: Job<DNSJobData>): Promise<void> {
    const { operation } = job.data;

    switch (operation) {
      case DNSOperationType.WIRE_RECORDS:
        return this.handleWireRecords(job as Job<WireDNSRecordsJobData>);
      case DNSOperationType.VERIFY_RECORDS:
        return this.handleVerifyRecords(job as Job<VerifyDNSRecordsJobData>);
      default:
        throw new Error(`Unknown DNS operation: ${operation}`);
    }
  }

  /**
   * Handle DNS record wiring
   */
  private async handleWireRecords(job: Job<WireDNSRecordsJobData>): Promise<void> {
    const {
      userId,
      projectId,
      domain,
      zoneId,
      emailProvider,
      customMXRecords,
      customSPF,
      dkimSelectors,
      githubOrg,
      vercelDomain,
      customCNAMEs,
    } = job.data;

    // Fetch user credentials from database
    const credentials = await fetchUserCredentials(userId);
    if (!credentials?.cloudflareApiToken) {
      throw new CloudflareApiError(
        [{ code: 1000, message: `Cloudflare credentials not found for user ${userId}` }],
        CloudflareErrorCategory.AUTH
      );
    }

    const client = new CloudflareClient({ apiToken: credentials.cloudflareApiToken });
    let recordsCreated = 0;

    // Track current state locally (starts as QUEUED when job is picked up)
    let currentState = DNSJobStatus.QUEUED;

    try {
      // Wire MX records
      await this.updateJobState(job, currentState, DNSJobStatus.WIRING_MX);
      currentState = DNSJobStatus.WIRING_MX;
      await this.publishEvent({
        type: DNSWorkerEventType.MX_WIRING_STARTED,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { domain, zoneId, recordType: 'MX', status: DNSJobStatus.WIRING_MX },
      });

      const mxRecords =
        customMXRecords ||
        (emailProvider !== EmailProvider.CUSTOM
          ? DEFAULT_MX_RECORDS[emailProvider]
          : undefined) ||
        [];
      for (const mx of mxRecords) {
        // Replace placeholder in Microsoft 365 MX record
        let mxValue = mx.value;
        if (emailProvider === EmailProvider.MICROSOFT_365) {
          const domainPrefix = domain.split('.')[0];
          mxValue = mxValue.replace('<domain>', domainPrefix);
        }

        await client.createDNSRecord(zoneId, {
          type: 'MX',
          name: domain,
          content: mxValue,
          priority: mx.priority,
          ttl: 1, // Automatic
          proxied: false, // MX records cannot be proxied
        });
        recordsCreated++;
      }

      await this.publishEvent({
        type: DNSWorkerEventType.MX_WIRING_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { domain, zoneId, recordType: 'MX', recordsCreated: mxRecords.length },
      });

      // Wire SPF record
      await this.updateJobState(job, currentState, DNSJobStatus.WIRING_SPF);
      currentState = DNSJobStatus.WIRING_SPF;
      await this.publishEvent({
        type: DNSWorkerEventType.SPF_WIRING_STARTED,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { domain, zoneId, recordType: 'TXT (SPF)', status: DNSJobStatus.WIRING_SPF },
      });

      const spfRecord =
        customSPF ||
        (emailProvider !== EmailProvider.CUSTOM
          ? DEFAULT_SPF_RECORDS[emailProvider]
          : undefined) ||
        'v=spf1 ~all';
      await client.createDNSRecord(zoneId, {
        type: 'TXT',
        name: domain,
        content: spfRecord,
        ttl: 1,
        proxied: false,
      });
      recordsCreated++;

      await this.publishEvent({
        type: DNSWorkerEventType.SPF_WIRING_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { domain, zoneId, recordType: 'TXT (SPF)', recordsCreated: 1 },
      });

      // Wire DKIM records (Google Workspace only)
      if (emailProvider === EmailProvider.GOOGLE_WORKSPACE && dkimSelectors && dkimSelectors.length > 0) {
        await this.updateJobState(job, currentState, DNSJobStatus.WIRING_DKIM);
        currentState = DNSJobStatus.WIRING_DKIM;
        await this.publishEvent({
          type: DNSWorkerEventType.DKIM_WIRING_STARTED,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: { domain, zoneId, recordType: 'TXT (DKIM)', status: DNSJobStatus.WIRING_DKIM },
        });

        for (const selector of dkimSelectors) {
          // DKIM records are TXT records with selector prefix
          // User must provide DKIM keys from Google Admin Console
          await client.createDNSRecord(zoneId, {
            type: 'TXT',
            name: `${selector}._domainkey.${domain}`,
            content: selector, // Placeholder - user must update with actual DKIM key
            ttl: 1,
            proxied: false,
          });
          recordsCreated++;
        }

        await this.publishEvent({
          type: DNSWorkerEventType.DKIM_WIRING_COMPLETE,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: { domain, zoneId, recordType: 'TXT (DKIM)', recordsCreated: dkimSelectors.length },
        });
      }
      // (If DKIM skipped, currentState remains WIRING_SPF which can transition to WIRING_DMARC)

      // Wire DMARC record
      await this.updateJobState(job, currentState, DNSJobStatus.WIRING_DMARC);
      currentState = DNSJobStatus.WIRING_DMARC;
      await this.publishEvent({
        type: DNSWorkerEventType.DMARC_WIRING_STARTED,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { domain, zoneId, recordType: 'TXT (DMARC)', status: DNSJobStatus.WIRING_DMARC },
      });

      await client.createDNSRecord(zoneId, {
        type: 'TXT',
        name: `_dmarc.${domain}`,
        content: DEFAULT_DMARC_RECORD(domain),
        ttl: 1,
        proxied: false,
      });
      recordsCreated++;

      await this.publishEvent({
        type: DNSWorkerEventType.DMARC_WIRING_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: { domain, zoneId, recordType: 'TXT (DMARC)', recordsCreated: 1 },
      });

      // Wire CNAME records
      const cnameRecords = [];
      if (githubOrg) {
        cnameRecords.push({ name: `www.${domain}`, value: `${githubOrg}.github.io` });
      }
      if (vercelDomain) {
        cnameRecords.push({ name: `app.${domain}`, value: vercelDomain });
      }
      if (customCNAMEs) {
        cnameRecords.push(...customCNAMEs);
      }

      if (cnameRecords.length > 0) {
        await this.updateJobState(job, currentState, DNSJobStatus.WIRING_CNAME);
        currentState = DNSJobStatus.WIRING_CNAME;
        await this.publishEvent({
          type: DNSWorkerEventType.CNAME_WIRING_STARTED,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: { domain, zoneId, recordType: 'CNAME', status: DNSJobStatus.WIRING_CNAME },
        });

        for (const cname of cnameRecords) {
          await client.createDNSRecord(zoneId, {
            type: 'CNAME',
            name: cname.name,
            content: cname.value,
            ttl: 1,
            proxied: false, // Can be enabled later for CDN
          });
          recordsCreated++;
        }

        await this.publishEvent({
          type: DNSWorkerEventType.CNAME_WIRING_COMPLETE,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: { domain, zoneId, recordType: 'CNAME', recordsCreated: cnameRecords.length },
        });
      }

      // Mark wiring as complete
      await this.updateJobState(job, currentState, DNSJobStatus.WIRING_COMPLETE);
      currentState = DNSJobStatus.WIRING_COMPLETE;
      await this.publishEvent({
        type: DNSWorkerEventType.WIRING_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: {
          domain,
          zoneId,
          recordsCreated,
          status: DNSJobStatus.WIRING_COMPLETE,
        },
      });

      // Store summary in job data
      await job.updateData({
        ...job.data,
        recordsCreated,
        wiringComplete: true,
      } as WireDNSRecordsJobData);
    } catch (error) {
      // Wrap error in CloudflareApiError for consistent handling
      const cloudflareError =
        error instanceof CloudflareApiError
          ? error
          : new CloudflareApiError(
              [{ code: 0, message: (error as Error).message }],
              // DNS wiring errors are usually retryable (network issues, rate limits)
              error instanceof Error ? undefined : undefined
            );
      await this.handleJobError(job, currentState, cloudflareError, DNSWorkerEventType.WIRING_FAILED);
    }
  }

  /**
   * Handle DNS record verification
   */
  private async handleVerifyRecords(job: Job<VerifyDNSRecordsJobData>): Promise<void> {
    const { userId, projectId, domain, zoneId, expectedRecords } = job.data;

    // Track current state locally (starts as WIRING_COMPLETE when job is picked up)
    let currentState = DNSJobStatus.WIRING_COMPLETE;

    await this.updateJobState(job, currentState, DNSJobStatus.VERIFYING);
    currentState = DNSJobStatus.VERIFYING;
    await this.publishEvent({
      type: DNSWorkerEventType.VERIFICATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: { domain, zoneId, status: DNSJobStatus.VERIFYING },
    });

    try {
      const resolver = new dns.Resolver();
      const verificationResults = [];

      for (const expected of expectedRecords) {
        try {
          let actual: string[] = [];

          // Query DNS based on record type
          switch (expected.type) {
            case 'MX':
              const mxRecords = await resolver.resolveMx(expected.name);
              actual = mxRecords.map((mx) => mx.exchange);
              break;
            case 'TXT':
              actual = (await resolver.resolveTxt(expected.name)).flat();
              break;
            case 'CNAME':
              actual = await resolver.resolveCname(expected.name);
              break;
            case 'A':
              actual = await resolver.resolve4(expected.name);
              break;
            case 'AAAA':
              actual = await resolver.resolve6(expected.name);
              break;
            default:
              console.warn(`Unsupported DNS record type for verification: ${expected.type}`);
              continue;
          }

          // Check if expected content is present
          const found = actual.some((record) =>
            record.toLowerCase().includes(expected.content.toLowerCase())
          );

          verificationResults.push({
            ...expected,
            found,
            actual,
          });
        } catch (err) {
          // Record not found or DNS error
          verificationResults.push({
            ...expected,
            found: false,
            error: (err as Error).message,
          });
        }
      }

      // Check if all records are verified
      const allVerified = verificationResults.every((result) => result.found);

      if (allVerified) {
        await this.updateJobState(job, currentState, DNSJobStatus.COMPLETE);
        currentState = DNSJobStatus.COMPLETE;
        await this.publishEvent({
          type: DNSWorkerEventType.VERIFICATION_COMPLETE,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: {
            domain,
            zoneId,
            verificationResults,
            status: DNSJobStatus.COMPLETE,
          },
        });
      } else {
        // Not all records verified - wrap in CloudflareApiError for proper retry handling
        const errorMessage = `DNS verification incomplete for ${domain}. ${verificationResults.filter((r) => !r.found).length} records not found.`;
        const dnsError = new CloudflareApiError(
          [{ code: 0, message: errorMessage }],
          // DNS propagation delays are network-related and retryable
          undefined
        );
        await this.handleJobError(job, currentState, dnsError, DNSWorkerEventType.VERIFICATION_FAILED);
      }
    } catch (error) {
      // Wrap DNS resolution errors in CloudflareApiError for consistent retry handling
      const err = error as Error;
      const dnsError = new CloudflareApiError(
        [{ code: 0, message: err.message }],
        // DNS resolution failures are network-related and retryable
        undefined
      );
      await this.handleJobError(job, currentState, dnsError, DNSWorkerEventType.VERIFICATION_FAILED);
    }
  }

  /**
   * Update job state with validation
   */
  private async updateJobState(
    job: Job<DNSJobData>,
    currentState: DNSJobStatus,
    newState: DNSJobStatus
  ): Promise<void> {
    if (!isValidDNSStateTransition(currentState, newState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
    }

    await job.updateProgress({ status: newState });
  }

  /**
   * Handle job error
   */
  private async handleJobError(
    job: Job<DNSJobData>,
    currentState: DNSJobStatus,
    error: CloudflareApiError,
    eventType: DNSWorkerEventType
  ): Promise<void> {
    const { userId, projectId, domain, zoneId } = job.data;

    await this.updateJobState(job, currentState, DNSJobStatus.FAILED);
    await this.publishEvent({
      type: eventType,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        domain,
        zoneId,
        error: error.message,
        status: DNSJobStatus.FAILED,
      },
    });

    // Determine if error is retryable
    if (error.isRetryable()) {
      throw error; // Let BullMQ retry
    } else {
      // Non-retryable error - fail permanently
      throw new UnrecoverableError(error.message);
    }
  }

  /**
   * Publish event to Redis pub/sub
   */
  private async publishEvent(event: DNSWorkerEvent): Promise<void> {
    if (this.eventPublisher) {
      await this.eventPublisher.publishEvent(event);
    }

    // Also publish to Redis pub/sub for SSE streaming
    await this.redis.publish(`worker:events:${event.projectId}`, JSON.stringify(event));
  }

  /**
   * Close worker and Redis connection
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
  }
}

/**
 * Cloudflare worker - BullMQ job handlers for Cloudflare operations
 *
 * Handles:
 * - Zone creation
 * - Nameserver updates (Cloudflare → domain registrar)
 * - Nameserver verification (DNS propagation checks)
 */

import { Worker, Job, Queue, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { promises as dns } from 'dns';
import {
  CloudflareClient,
  CloudflareApiError,
  CloudflareErrorCategory,
  NamecheapClient,
  splitDomain,
  type CloudflareJobData,
  type CloudflareWorkerConfig,
  type CloudflareWorkerEvent,
  type ICloudflareWorkerEventPublisher,
  type CreateZoneJobData,
  type UpdateNameserversJobData,
  type VerifyNameserversJobData,
  CloudflareOperationType,
  CloudflareJobStatus,
  CloudflareWorkerEventType,
  isValidCloudflareStateTransition,
  WORKER_LOCK_DURATION,
  WORKER_LOCK_RENEW_TIME,
} from '@forj/shared';
import { updateProjectService, fetchUserCredentials } from './database.js';

/**
 * Sanitize error messages to remove sensitive credentials
 */
function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let message = error.message;

  // Redact Namecheap API credentials
  message = message.replace(/ApiKey=[^&\s]+/gi, 'ApiKey=***REDACTED***');
  message = message.replace(/ApiUser=[^&\s]+/gi, 'ApiUser=***REDACTED***');
  message = message.replace(/UserName=[^&\s]+/gi, 'UserName=***REDACTED***');
  message = message.replace(/ClientIp=[^&\s]+/gi, 'ClientIp=***REDACTED***');

  // Redact Cloudflare API tokens
  message = message.replace(/Bearer\s+[^\s]+/gi, 'Bearer ***REDACTED***');
  message = message.replace(/X-Auth-Key:\s*[^\s]+/gi, 'X-Auth-Key: ***REDACTED***');

  return message;
}

/**
 * Cloudflare worker class
 */
export class CloudflareWorker {
  private worker: Worker<CloudflareJobData>;
  private redis: Redis;
  private eventPublisher?: ICloudflareWorkerEventPublisher;
  private cloudflareQueue: Queue;
  private namecheapConfig: {
    apiUser: string;
    apiKey: string;
    userName: string;
    clientIp: string;
    sandbox: boolean;
  };

  constructor(config: CloudflareWorkerConfig) {
    this.redis = new Redis(config.redis);
    this.eventPublisher = config.eventPublisher;

    // Validate Namecheap credentials (required for NS updates)
    const requiredEnvVars = [
      'NAMECHEAP_API_USER',
      'NAMECHEAP_API_KEY',
      'NAMECHEAP_USERNAME',
      'NAMECHEAP_CLIENT_IP',
    ];
    const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      throw new Error(
        `CloudflareWorker requires Namecheap credentials for nameserver updates. Missing environment variables: ${missingVars.join(', ')}`
      );
    }

    // Get Namecheap credentials from environment for NS updates
    this.namecheapConfig = {
      apiUser: process.env.NAMECHEAP_API_USER!,
      apiKey: process.env.NAMECHEAP_API_KEY!,
      userName: process.env.NAMECHEAP_USERNAME!,
      clientIp: process.env.NAMECHEAP_CLIENT_IP!,
      sandbox: process.env.NAMECHEAP_SANDBOX === 'true',
    };

    this.worker = new Worker<CloudflareJobData>(
      'cloudflare',
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

    // Create Queue instance for queuing nameserver update jobs (reused across all calls)
    this.cloudflareQueue = new Queue('cloudflare', {
      connection: config.redis,
    });

    this.setupEventHandlers();
  }

  /**
   * Set up worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`Cloudflare job ${job.id} completed`);

      // Only mark service as 'complete' in DB if it's the final step of the workflow.
      // Cloudflare jobs are multi-step (CREATE_ZONE → UPDATE_NAMESERVERS → VERIFY_NAMESERVERS),
      // and the 'completed' event fires for each step. We only want to mark the service
      // complete when nameserver verification finishes successfully.
      const progress = job.progress as { status?: CloudflareJobStatus };

      if (progress?.status === CloudflareJobStatus.COMPLETE) {
        const zoneId = 'zoneId' in job.data ? job.data.zoneId : undefined;
        const now = new Date().toISOString();

        // Update database with completion status
        void updateProjectService(job.data.projectId, 'cloudflare', {
          status: 'complete',
          value: zoneId,
          updatedAt: now,
          completedAt: now,
        }).catch((err) => {
          console.error('Failed to update project status in database:', err);
        });
      }
    });

    this.worker.on('failed', (job, err) => {
      const sanitizedError = sanitizeErrorMessage(err);
      console.error(`Cloudflare job ${job?.id} failed:`, sanitizedError);

      if (job) {
        // Update database with failure status (sanitized to avoid leaking credentials)
        void updateProjectService(job.data.projectId, 'cloudflare', {
          status: 'failed',
          error: sanitizedError,
          updatedAt: new Date().toISOString(),
        }).catch((dbErr) => {
          console.error('Failed to update project status in database:', dbErr);
        });
      }
    });

    this.worker.on('error', (err) => {
      console.error('Cloudflare worker error:', err);
    });
  }

  /**
   * Process Cloudflare job based on operation type
   */
  private async processJob(job: Job<CloudflareJobData>): Promise<void> {
    const { operation } = job.data;

    switch (operation) {
      case CloudflareOperationType.CREATE_ZONE:
        return this.handleCreateZone(job as Job<CreateZoneJobData>);
      case CloudflareOperationType.UPDATE_NAMESERVERS:
        return this.handleUpdateNameservers(job as Job<UpdateNameserversJobData>);
      case CloudflareOperationType.VERIFY_NAMESERVERS:
        return this.handleVerifyNameservers(job as Job<VerifyNameserversJobData>);
      default:
        throw new Error(`Unknown Cloudflare operation: ${operation}`);
    }
  }

  /**
   * Handle zone creation
   */
  private async handleCreateZone(job: Job<CreateZoneJobData>): Promise<void> {
    const { userId, projectId, domain } = job.data;

    // Track current state locally (starts as QUEUED when job is picked up)
    let currentState = CloudflareJobStatus.QUEUED;

    // Update state: QUEUED → CREATING_ZONE
    await this.updateJobState(job, currentState, CloudflareJobStatus.CREATING_ZONE);
    currentState = CloudflareJobStatus.CREATING_ZONE;
    await this.publishEvent({
      type: CloudflareWorkerEventType.ZONE_CREATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: { domain, status: CloudflareJobStatus.CREATING_ZONE },
    });

    // Fetch user credentials from database (outside try block so they're in scope for error handler)
    const credentials = await fetchUserCredentials(userId);
    if (!credentials?.cloudflareApiToken || !credentials?.cloudflareAccountId) {
      throw new CloudflareApiError(
        [{ code: 1000, message: `Cloudflare credentials not found for user ${userId}` }],
        CloudflareErrorCategory.AUTH
      );
    }

    const apiToken = credentials.cloudflareApiToken;
    const accountId = credentials.cloudflareAccountId;

    try {
      const client = new CloudflareClient({ apiToken, accountId });

      // Create zone (account ID is required for zone creation)
      if (!accountId) {
        throw new Error('Cloudflare account ID is required for zone creation');
      }

      const zone = await client.createZone({
        name: domain,
        account: { id: accountId },
        jump_start: true, // Auto-scan for DNS records
      });

      // Handle successful zone creation (new zone)
      await this.handleZoneCreationSuccess(job, currentState, zone, false);
      currentState = CloudflareJobStatus.ZONE_CREATED;
    } catch (error) {
      // If zone already exists, consider it a success (idempotent)
      if (error instanceof CloudflareApiError && error.category === CloudflareErrorCategory.ZONE_EXISTS) {
        console.log(`Zone for ${domain} already exists, fetching existing zone...`);

        const client = new CloudflareClient({ apiToken, accountId });
        const zones = await client.listZones(accountId, domain);
        const existingZone = zones.find((z) => z.name === domain);

        if (existingZone) {
          // Handle successful zone creation (existing zone)
          await this.handleZoneCreationSuccess(job, currentState, existingZone, true);
          currentState = CloudflareJobStatus.ZONE_CREATED;
        } else {
          throw new Error(`Zone exists but could not be found for domain: ${domain}`);
        }
      } else {
        const apiError =
          error instanceof CloudflareApiError
            ? error
            : new CloudflareApiError(
                [{ code: 0, message: (error as Error).message }],
                CloudflareErrorCategory.UNKNOWN
              );
        await this.handleJobError(job, currentState, apiError, CloudflareWorkerEventType.ZONE_CREATION_FAILED);
      }
    }
  }

  /**
   * Handle nameserver updates
   */
  private async handleUpdateNameservers(job: Job<UpdateNameserversJobData>): Promise<void> {
    const { userId, projectId, domain, zoneId, nameservers, namecheapAccessToken } = job.data;

    // Track current state locally (starts as ZONE_CREATED)
    let currentState = CloudflareJobStatus.ZONE_CREATED;

    // Update state: ZONE_CREATED → UPDATING_NAMESERVERS
    await this.updateJobState(job, currentState, CloudflareJobStatus.UPDATING_NAMESERVERS);
    currentState = CloudflareJobStatus.UPDATING_NAMESERVERS;
    await this.publishEvent({
      type: CloudflareWorkerEventType.NAMESERVER_UPDATE_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        domain,
        zoneId,
        nameservers,
        status: CloudflareJobStatus.UPDATING_NAMESERVERS,
      },
    });

    try {
      // Update nameservers at domain registrar (Namecheap)
      // This is where we hand off DNS authority from registrar to Cloudflare
      const namecheapClient = new NamecheapClient(this.namecheapConfig);

      console.log(`Updating nameservers for ${domain} to Cloudflare NS:`, nameservers);

      // Split domain into SLD and TLD using shared utility (handles multi-part TLDs like .co.uk)
      const { sld, tld } = splitDomain(domain);

      // Call Namecheap API to update nameservers
      await namecheapClient.setCustomNameservers(sld, tld, nameservers);

      console.log(`✅ Nameservers updated successfully for ${domain}`);

      // Update state: UPDATING_NAMESERVERS → NAMESERVERS_UPDATED
      await this.updateJobState(job, currentState, CloudflareJobStatus.NAMESERVERS_UPDATED);
      currentState = CloudflareJobStatus.NAMESERVERS_UPDATED;
      await this.publishEvent({
        type: CloudflareWorkerEventType.NAMESERVER_UPDATE_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: {
          domain,
          zoneId,
          nameservers,
          status: CloudflareJobStatus.NAMESERVERS_UPDATED,
        },
      });
    } catch (error) {
      const apiError = new CloudflareApiError(
        [{ code: 0, message: (error as Error).message }],
        CloudflareErrorCategory.NETWORK // Assuming registrar errors are network-related and retryable
      );
      await this.handleJobError(
        job,
        currentState,
        apiError,
        CloudflareWorkerEventType.NAMESERVER_UPDATE_FAILED
      );
    }
  }

  /**
   * Handle nameserver verification
   */
  private async handleVerifyNameservers(job: Job<VerifyNameserversJobData>): Promise<void> {
    const { userId, projectId, domain, zoneId, expectedNameservers } = job.data;

    // Track current state locally (starts as NAMESERVERS_UPDATED)
    let currentState = CloudflareJobStatus.NAMESERVERS_UPDATED;

    // Update state: NAMESERVERS_UPDATED → VERIFYING_NAMESERVERS
    await this.updateJobState(job, currentState, CloudflareJobStatus.VERIFYING_NAMESERVERS);
    currentState = CloudflareJobStatus.VERIFYING_NAMESERVERS;
    await this.publishEvent({
      type: CloudflareWorkerEventType.NAMESERVER_VERIFICATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        domain,
        zoneId,
        expectedNameservers,
        status: CloudflareJobStatus.VERIFYING_NAMESERVERS,
      },
    });

    try {
      // Query DNS for nameservers
      const resolver = new dns.Resolver();
      const actualNameservers = await resolver.resolveNs(domain);

      // Normalize nameservers (lowercase, remove trailing dots)
      const normalizeNs = (ns: string) => ns.toLowerCase().replace(/\.$/, '');
      const normalizedActual = actualNameservers.map(normalizeNs).sort();
      const normalizedExpected = expectedNameservers.map(normalizeNs).sort();

      // Check if all expected nameservers are present
      const allPresent = normalizedExpected.every((expected) =>
        normalizedActual.includes(expected)
      );

      if (allPresent) {
        // Nameservers verified successfully
        await this.updateJobState(job, currentState, CloudflareJobStatus.COMPLETE);
        currentState = CloudflareJobStatus.COMPLETE;
        await this.publishEvent({
          type: CloudflareWorkerEventType.NAMESERVER_VERIFICATION_COMPLETE,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: {
            domain,
            zoneId,
            expectedNameservers: normalizedExpected,
            actualNameservers: normalizedActual,
            status: CloudflareJobStatus.COMPLETE,
          },
        });
      } else {
        // Nameservers not yet propagated - wrap in CloudflareApiError for proper retry handling
        const errorMessage = `Nameserver verification failed for ${domain}. Expected: ${normalizedExpected.join(', ')}. Got: ${normalizedActual.join(', ')}`;
        const dnsError = new CloudflareApiError(
          [{ code: 0, message: errorMessage }],
          CloudflareErrorCategory.NETWORK
        );
        await this.handleJobError(job, currentState, dnsError, CloudflareWorkerEventType.NAMESERVER_VERIFICATION_FAILED);
      }
    } catch (error) {
      // DNS resolution errors are retryable (propagation takes time)
      const err = error as Error;

      // Create a CloudflareApiError for DNS resolution failures
      const dnsError = new CloudflareApiError(
        [{ code: 0, message: err.message }],
        CloudflareErrorCategory.NETWORK
      );

      await this.handleJobError(job, currentState, dnsError, CloudflareWorkerEventType.NAMESERVER_VERIFICATION_FAILED);
    }
  }

  /**
   * Update job state with validation
   */
  private async updateJobState(
    job: Job<CloudflareJobData>,
    currentState: CloudflareJobStatus,
    newState: CloudflareJobStatus
  ): Promise<void> {
    if (!isValidCloudflareStateTransition(currentState, newState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
    }

    await job.updateProgress({ status: newState });
  }

  /**
   * Handle job error
   */
  private async handleJobError(
    job: Job<CloudflareJobData>,
    currentState: CloudflareJobStatus,
    error: CloudflareApiError,
    eventType: CloudflareWorkerEventType
  ): Promise<void> {
    const { userId, projectId, domain } = job.data;
    const zoneId = 'zoneId' in job.data ? job.data.zoneId : undefined;

    await this.updateJobState(job, currentState, CloudflareJobStatus.FAILED);
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
        errorCategory: error.category,
        status: CloudflareJobStatus.FAILED,
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
  private async publishEvent(event: CloudflareWorkerEvent): Promise<void> {
    if (this.eventPublisher) {
      await this.eventPublisher.publishEvent(event);
    }

    // Also publish to Redis pub/sub for SSE streaming
    await this.redis.publish(`project:${event.projectId}:events`, JSON.stringify(event));
  }

  /**
   * Handle successful zone creation (new or existing)
   * Shared logic for updating job state, publishing events, and queuing nameserver updates
   */
  private async handleZoneCreationSuccess(
    job: Job<CreateZoneJobData>,
    currentState: CloudflareJobStatus,
    zone: { id: string; name_servers: string[]; status: string },
    alreadyExisted: boolean = false
  ): Promise<void> {
    const { userId, projectId, domain } = job.data;

    // Update state: CREATING_ZONE → ZONE_CREATED
    await this.updateJobState(job, currentState, CloudflareJobStatus.ZONE_CREATED);

    // Publish zone creation complete event
    await this.publishEvent({
      type: CloudflareWorkerEventType.ZONE_CREATION_COMPLETE,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        domain,
        zoneId: zone.id,
        nameservers: zone.name_servers,
        status: CloudflareJobStatus.ZONE_CREATED,
        ...(alreadyExisted && { alreadyExisted: true }),
      },
    });

    // Store zone details in job data
    await job.updateData({
      ...job.data,
      zoneId: zone.id,
      nameservers: zone.name_servers,
      zoneStatus: zone.status,
    } as CreateZoneJobData);

    // Auto-queue nameserver update job to hand off DNS authority to Cloudflare
    // Note: Credentials are NOT passed in job data (PR #85) - they will be fetched from database
    await this.queueNameserverUpdate({
      userId,
      projectId,
      domain,
      zoneId: zone.id,
      nameservers: zone.name_servers,
    });
  }

  /**
   * Queue nameserver update job
   *
   * After zone creation, we need to update the domain's nameservers at the registrar
   * (Namecheap) to point to Cloudflare's nameservers. This hands off DNS authority.
   *
   * NOTE: Credentials are NOT passed in job data (PR #85). The UpdateNameserversJob handler
   * will fetch credentials from the database when processing.
   */
  private async queueNameserverUpdate(data: {
    userId: string;
    projectId: string;
    domain: string;
    zoneId: string;
    nameservers: string[];
  }): Promise<void> {
    const { userId, projectId, domain, zoneId, nameservers } = data;

    const jobData: UpdateNameserversJobData = {
      operation: CloudflareOperationType.UPDATE_NAMESERVERS,
      userId,
      projectId,
      domain,
      // apiToken and accountId removed (PR #85) - fetched from database in handler
      zoneId,
      nameservers,
      namecheapAccessToken: undefined, // Not used - we get creds from env
    };

    await this.cloudflareQueue.add('update-nameservers', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    console.log(`✅ Queued nameserver update job for ${domain} (zone: ${zoneId})`);
  }

  /**
   * Close worker, queue, and Redis connection
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.cloudflareQueue.close();
    await this.redis.quit();
  }
}

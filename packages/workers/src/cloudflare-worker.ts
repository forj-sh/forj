/**
 * Cloudflare worker - BullMQ job handlers for Cloudflare operations
 *
 * Handles:
 * - Zone creation
 * - Nameserver updates (Cloudflare → domain registrar)
 * - Nameserver verification (DNS propagation checks)
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { promises as dns } from 'dns';
import {
  CloudflareClient,
  CloudflareApiError,
  CloudflareErrorCategory,
  NamecheapClient,
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
} from '@forj/shared';

/**
 * Cloudflare worker class
 */
export class CloudflareWorker {
  private worker: Worker<CloudflareJobData>;
  private redis: Redis;
  private eventPublisher?: ICloudflareWorkerEventPublisher;

  constructor(config: CloudflareWorkerConfig) {
    this.redis = new Redis(config.redis);
    this.eventPublisher = config.eventPublisher;

    this.worker = new Worker<CloudflareJobData>(
      'cloudflare',
      async (job) => this.processJob(job),
      {
        connection: config.redis,
        concurrency: config.concurrency || 3,
      }
    );

    this.setupEventHandlers();
  }

  /**
   * Set up worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`Cloudflare job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Cloudflare job ${job?.id} failed:`, err);
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
    const { userId, projectId, domain, apiToken, accountId } = job.data;

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

      // Update state: CREATING_ZONE → ZONE_CREATED
      await this.updateJobState(job, currentState, CloudflareJobStatus.ZONE_CREATED);
      currentState = CloudflareJobStatus.ZONE_CREATED;
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
        },
      });

      // Store zone details in job data (extend runtime data)
      await job.updateData({
        ...job.data,
        zoneId: zone.id,
        nameservers: zone.name_servers,
        zoneStatus: zone.status,
      } as CreateZoneJobData);
    } catch (error) {
      // If zone already exists, consider it a success (idempotent)
      if (error instanceof CloudflareApiError && error.category === CloudflareErrorCategory.ZONE_EXISTS) {
        console.log(`Zone for ${domain} already exists, fetching existing zone...`);

        const client = new CloudflareClient({ apiToken, accountId });
        const zones = await client.listZones(accountId, domain);
        const existingZone = zones.find((z) => z.name === domain);

        if (existingZone) {
          await this.updateJobState(job, currentState, CloudflareJobStatus.ZONE_CREATED);
          currentState = CloudflareJobStatus.ZONE_CREATED;
          await this.publishEvent({
            type: CloudflareWorkerEventType.ZONE_CREATION_COMPLETE,
            projectId,
            userId,
            jobId: job.id!,
            timestamp: new Date().toISOString(),
            data: {
              domain,
              zoneId: existingZone.id,
              nameservers: existingZone.name_servers,
              status: CloudflareJobStatus.ZONE_CREATED,
              alreadyExisted: true,
            },
          });

          await job.updateData({
            ...job.data,
            zoneId: existingZone.id,
            nameservers: existingZone.name_servers,
            zoneStatus: existingZone.status,
          } as CreateZoneJobData);
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
      if (namecheapAccessToken) {
        // TODO: Get Namecheap config from environment or job data
        // For now, we'll assume the job data includes enough info
        // In production, this would need Namecheap API credentials
        console.log(`Would update nameservers for ${domain} to:`, nameservers);
        console.log('Namecheap integration not yet implemented in this stack');
        // const namecheapClient = new NamecheapClient({...});
        // await namecheapClient.setCustomNameservers(domain, nameservers);
      }

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
      await job.moveToFailed(error, job.token || '', true);
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
   * Close worker and Redis connection
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
  }
}

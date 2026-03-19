/**
 * Domain worker - BullMQ worker for domain operations
 *
 * Reference: docs/namecheap-integration.md Section 5
 *
 * Processes domain operations (check, register, renew, configure) using
 * Namecheap API with priority queue and rate limiting.
 *
 * IMPORTANT: All Namecheap API calls MUST go through requestQueue.submit()
 * to ensure proper rate limiting (20 req/min) and priority handling.
 */

import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  NamecheapClient,
  NamecheapRequestQueue,
  RequestPriority,
  createNamecheapRateLimiter,
  type RequestExecutor,
  type DomainJobData,
  type CheckDomainJobData,
  type RegisterDomainJobData,
  type RenewDomainJobData,
  type SetNameserversJobData,
  type GetDomainInfoJobData,
  DomainOperationType,
  DomainJobStatus,
  DomainWorkerEventType,
  type DomainWorkerConfig,
  type DomainWorkerEvent,
  type IWorkerEventPublisher,
  isValidStateTransition,
  splitDomain,
  WORKER_LOCK_DURATION,
  WORKER_LOCK_RENEW_TIME,
} from '@forj/shared';
import { updateProjectService } from './database.js';

/**
 * Sanitize error message to prevent API key exposure
 *
 * Network errors from fetch() may include full URLs with API keys.
 * This function removes sensitive query parameters from error messages.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let message = error.message;

  // Remove API key from URLs in error messages
  message = message.replace(/ApiKey=[^&\s]+/gi, 'ApiKey=***REDACTED***');
  message = message.replace(/apikey=[^&\s]+/gi, 'apikey=***REDACTED***');

  return message;
}

/**
 * Domain worker class
 *
 * Processes domain jobs from BullMQ queue with Namecheap API integration.
 * All API calls are routed through NamecheapRequestQueue for rate limiting.
 */
export class DomainWorker {
  private readonly worker: Worker;
  private readonly namecheapClient: NamecheapClient;
  private readonly requestQueue: NamecheapRequestQueue;
  private readonly config: DomainWorkerConfig;
  private readonly eventPublisher?: IWorkerEventPublisher;

  constructor(config: DomainWorkerConfig, redis: Redis) {
    this.config = config;
    this.eventPublisher = config.eventPublisher;

    // Initialize Namecheap client
    this.namecheapClient = new NamecheapClient({
      apiUser: config.namecheap.apiUser,
      apiKey: config.namecheap.apiKey,
      userName: config.namecheap.userName,
      clientIp: config.namecheap.clientIp,
      sandbox: config.namecheap.sandbox,
    });

    // Create executor function that routes commands to Namecheap client
    const executor: RequestExecutor = async (command: string, params: Record<string, string>) => {
      // Route command to appropriate client method
      // This is called by the request queue after acquiring rate limit slot
      return this.namecheapClient.executeRequest(command, params);
    };

    // Initialize rate limiter and request queue with executor
    const rateLimiter = createNamecheapRateLimiter(redis);
    this.requestQueue = new NamecheapRequestQueue(rateLimiter, redis, executor);

    // Create BullMQ worker with retry configuration
    // Note: Pass connection options, not Redis instance, to avoid ioredis version conflicts
    // Note: Retry configuration is set on the Queue when jobs are added, not on the Worker
    this.worker = new Worker(
      config.queue.name,
      async (job: Job<DomainJobData>) => {
        return this.processJob(job);
      },
      {
        connection: {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
        },
        concurrency: config.queue.concurrency,
        // Lock configuration to prevent "Missing lock" errors
        // See packages/shared/src/worker-config.ts for default values
        lockDuration: WORKER_LOCK_DURATION,
        lockRenewTime: WORKER_LOCK_RENEW_TIME,
      }
    );

    // Worker event listeners
    // Note: Using void to explicitly ignore promise (emitEvent handles its own errors)
    this.worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed`);

      // Update database with completion status
      void updateProjectService(job.data.projectId, 'domain', {
        status: 'complete',
        value: job.data.domainName,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }).catch((err) => {
        console.error('Failed to update project status in database:', err);
      });

      void this.emitEvent({
        type: DomainWorkerEventType.JOB_COMPLETED,
        jobId: job.id || '',
        projectId: job.data.projectId,
        operation: job.data.operation,
        status: DomainJobStatus.COMPLETE,
        timestamp: Date.now(),
      }).catch((err) => {
        console.error('Failed to emit job completed event:', err);
      });
    });

    this.worker.on('failed', (job, error) => {
      // Sanitize error to prevent API key exposure in logs
      const sanitizedError = sanitizeErrorMessage(error);
      console.error(`Job ${job?.id} failed:`, sanitizedError);

      if (job) {
        // Update database with failure status
        void updateProjectService(job.data.projectId, 'domain', {
          status: 'failed',
          error: sanitizedError,
          updatedAt: new Date().toISOString(),
        }).catch((err) => {
          console.error('Failed to update project status in database:', err);
        });

        void this.emitEvent({
          type: DomainWorkerEventType.JOB_FAILED,
          jobId: job.id || '',
          projectId: job.data.projectId,
          operation: job.data.operation,
          status: DomainJobStatus.FAILED,
          timestamp: Date.now(),
          error: sanitizedError,
        }).catch((err) => {
          console.error('Failed to emit job failed event:', err);
        });
      }
    });
  }

  /**
   * Process a domain job
   *
   * @param job - BullMQ job
   * @returns Job result
   */
  private async processJob(job: Job<DomainJobData>): Promise<any> {
    const data = job.data;

    // Emit job started event
    await this.emitEvent({
      type: DomainWorkerEventType.JOB_STARTED,
      jobId: data.jobId,
      projectId: data.projectId,
      operation: data.operation,
      status: data.status,
      timestamp: Date.now(),
    });

    // Job is being processed - no need to validate transition to QUEUED
    // The status will be updated by individual handlers
    data.updatedAt = Date.now();

    // Route to appropriate handler based on operation type
    try {
      switch (data.operation) {
        case DomainOperationType.CHECK:
          return await this.handleCheckDomain(job as Job<CheckDomainJobData>);

        case DomainOperationType.REGISTER:
          return await this.handleRegisterDomain(job as Job<RegisterDomainJobData>);

        case DomainOperationType.RENEW:
          return await this.handleRenewDomain(job as Job<RenewDomainJobData>);

        case DomainOperationType.SET_NAMESERVERS:
          return await this.handleSetNameservers(job as Job<SetNameserversJobData>);

        case DomainOperationType.GET_INFO:
          return await this.handleGetDomainInfo(job as Job<GetDomainInfoJobData>);

        default:
          throw new Error(`Unknown operation type: ${(data as any).operation}`);
      }
    } catch (error) {
      // Sanitize error before re-throwing
      const sanitizedMessage = sanitizeErrorMessage(error);
      throw new Error(sanitizedMessage);
    }
  }

  /**
   * Handle check domain availability
   *
   * Routes through priority queue with INTERACTIVE priority (user waiting)
   */
  private async handleCheckDomain(job: Job<CheckDomainJobData>): Promise<CheckDomainJobData> {
    const data = job.data;

    // Update status
    data.status = DomainJobStatus.CHECKING;
    data.updatedAt = Date.now();

    // Check domains via priority queue (executes API call with rate limiting)
    const checkResults = await this.requestQueue.submit<any>(
      'namecheap.domains.check',
      { DomainList: data.domains.join(',') },
      RequestPriority.INTERACTIVE,
      data.userId
    );

    // Update job data with results
    data.results = checkResults;
    data.status = DomainJobStatus.COMPLETE;
    data.updatedAt = Date.now();

    return data;
  }

  /**
   * Handle domain registration
   *
   * Multi-step process: check → register → configure nameservers
   * All API calls routed through priority queue with CRITICAL priority (user paid)
   */
  private async handleRegisterDomain(
    job: Job<RegisterDomainJobData>
  ): Promise<RegisterDomainJobData> {
    const data = job.data;

    // Step 1: Check availability first
    data.status = DomainJobStatus.CHECKING;
    data.updatedAt = Date.now();
    await job.updateProgress(25);

    await this.emitEvent({
      type: DomainWorkerEventType.JOB_PROGRESS,
      jobId: data.jobId,
      projectId: data.projectId,
      operation: data.operation,
      status: data.status,
      timestamp: Date.now(),
      data: { step: 'checking', progress: 25 },
    });

    // Route availability check through queue
    const checkResult = await this.requestQueue.submit<any>(
      'namecheap.domains.check',
      { DomainList: data.domainName },
      RequestPriority.CRITICAL,
      data.userId
    );

    if (!checkResult[0]?.available) {
      data.status = DomainJobStatus.UNAVAILABLE;
      data.error = `Domain ${data.domainName} is not available`;
      throw new Error(data.error);
    }

    data.status = DomainJobStatus.AVAILABLE;
    await job.updateProgress(50);

    // Step 2: Register domain (CRITICAL priority - user has paid)
    // NOTE: Do NOT pass nameservers here - will be configured separately if needed
    data.status = DomainJobStatus.REGISTERING;
    data.updatedAt = Date.now();

    await this.emitEvent({
      type: DomainWorkerEventType.JOB_PROGRESS,
      jobId: data.jobId,
      projectId: data.projectId,
      operation: data.operation,
      status: data.status,
      timestamp: Date.now(),
      data: { step: 'registering', progress: 50 },
    });

    // Route registration through queue
    const registerParams: Record<string, string> = {
      DomainName: data.domainName,
      Years: data.years.toString(),
      // Flatten contact info
      RegistrantFirstName: data.registrant.firstName,
      RegistrantLastName: data.registrant.lastName,
      RegistrantAddress1: data.registrant.address1,
      RegistrantCity: data.registrant.city,
      RegistrantStateProvince: data.registrant.stateProvince,
      RegistrantPostalCode: data.registrant.postalCode,
      RegistrantCountry: data.registrant.country,
      RegistrantPhone: data.registrant.phone,
      RegistrantEmailAddress: data.registrant.emailAddress,
      TechFirstName: data.tech.firstName,
      TechLastName: data.tech.lastName,
      TechAddress1: data.tech.address1,
      TechCity: data.tech.city,
      TechStateProvince: data.tech.stateProvince,
      TechPostalCode: data.tech.postalCode,
      TechCountry: data.tech.country,
      TechPhone: data.tech.phone,
      TechEmailAddress: data.tech.emailAddress,
      AdminFirstName: data.admin.firstName,
      AdminLastName: data.admin.lastName,
      AdminAddress1: data.admin.address1,
      AdminCity: data.admin.city,
      AdminStateProvince: data.admin.stateProvince,
      AdminPostalCode: data.admin.postalCode,
      AdminCountry: data.admin.country,
      AdminPhone: data.admin.phone,
      AdminEmailAddress: data.admin.emailAddress,
      AuxBillingFirstName: data.auxBilling.firstName,
      AuxBillingLastName: data.auxBilling.lastName,
      AuxBillingAddress1: data.auxBilling.address1,
      AuxBillingCity: data.auxBilling.city,
      AuxBillingStateProvince: data.auxBilling.stateProvince,
      AuxBillingPostalCode: data.auxBilling.postalCode,
      AuxBillingCountry: data.auxBilling.country,
      AuxBillingPhone: data.auxBilling.phone,
      AuxBillingEmailAddress: data.auxBilling.emailAddress,
      AddFreeWhoisguard: data.addFreeWhoisguard ? 'yes' : 'no',
      WGEnabled: data.wgEnabled ? 'yes' : 'no',
    };

    if (data.isPremiumDomain && data.premiumPrice) {
      registerParams.IsPremiumDomain = 'true';
      registerParams.PremiumPrice = data.premiumPrice.toString();
    }

    if (data.promotionCode) {
      registerParams.PromotionCode = data.promotionCode;
    }

    const registerResult = await this.requestQueue.submit<any>(
      'namecheap.domains.create',
      registerParams,
      RequestPriority.CRITICAL,
      data.userId
    );

    data.result = registerResult;
    await job.updateProgress(75);

    // Check if domain was actually registered
    // Namecheap can return success but with registered: false for pending domains
    if (!registerResult?.registered) {
      data.status = DomainJobStatus.FAILED;
      data.error = 'Domain registration pending or failed';
      throw new Error(data.error);
    }

    // Step 3: Configure nameservers if provided (only if registration succeeded)
    if (data.nameservers && data.nameservers.length > 0) {
      data.status = DomainJobStatus.CONFIGURING;
      data.updatedAt = Date.now();

      await this.emitEvent({
        type: DomainWorkerEventType.JOB_PROGRESS,
        jobId: data.jobId,
        projectId: data.projectId,
        operation: data.operation,
        status: data.status,
        timestamp: Date.now(),
        data: { step: 'configuring', progress: 75 },
      });

      const { sld, tld } = splitDomain(data.domainName);
      await this.requestQueue.submit<any>(
        'namecheap.domains.dns.setCustom',
        {
          SLD: sld,
          TLD: tld,
          Nameservers: data.nameservers.join(','),
        },
        RequestPriority.CRITICAL,
        data.userId
      );
    }

    // Complete
    data.status = DomainJobStatus.COMPLETE;
    data.updatedAt = Date.now();
    await job.updateProgress(100);

    return data;
  }

  /**
   * Handle domain renewal
   *
   * Routes through priority queue with CRITICAL priority (user paid)
   */
  private async handleRenewDomain(job: Job<RenewDomainJobData>): Promise<RenewDomainJobData> {
    const data = job.data;

    // Update status
    data.status = DomainJobStatus.REGISTERING; // Reusing REGISTERING for renewal
    data.updatedAt = Date.now();

    // Renew domain via queue (CRITICAL priority - user has paid)
    const params: Record<string, string> = {
      DomainName: data.domainName,
      Years: data.years.toString(),
    };

    if (data.isPremiumDomain && data.premiumPrice) {
      params.IsPremiumDomain = 'true';
      params.PremiumPrice = data.premiumPrice.toString();
    }

    if (data.promotionCode) {
      params.PromotionCode = data.promotionCode;
    }

    const result = await this.requestQueue.submit<any>(
      'namecheap.domains.renew',
      params,
      RequestPriority.CRITICAL,
      data.userId
    );

    data.result = result;
    data.status = DomainJobStatus.COMPLETE;
    data.updatedAt = Date.now();

    return data;
  }

  /**
   * Handle set nameservers
   *
   * Routes through priority queue
   */
  private async handleSetNameservers(
    job: Job<SetNameserversJobData>
  ): Promise<SetNameserversJobData> {
    const data = job.data;

    data.status = DomainJobStatus.CONFIGURING;
    data.updatedAt = Date.now();

    const { sld, tld } = splitDomain(data.domainName);
    const updated = await this.requestQueue.submit<any>(
      'namecheap.domains.dns.setCustom',
      {
        SLD: sld,
        TLD: tld,
        Nameservers: data.nameservers.join(','),
      },
      RequestPriority.CRITICAL,
      data.userId
    );

    data.result = { updated };
    data.status = DomainJobStatus.COMPLETE;
    data.updatedAt = Date.now();

    return data;
  }

  /**
   * Handle get domain info
   *
   * Routes through priority queue with BACKGROUND priority
   */
  private async handleGetDomainInfo(
    job: Job<GetDomainInfoJobData>
  ): Promise<GetDomainInfoJobData> {
    const data = job.data;

    // Get domain info via queue (BACKGROUND priority - monitoring/status check)
    const result = await this.requestQueue.submit<any>(
      'namecheap.domains.getInfo',
      { DomainName: data.domainName },
      RequestPriority.BACKGROUND,
      data.userId
    );

    data.result = result;
    data.status = DomainJobStatus.COMPLETE;
    data.updatedAt = Date.now();

    return data;
  }

  /**
   * Emit worker event
   *
   * Publishes events to Redis pub/sub for real-time SSE streaming to CLI.
   * Falls back to console.log if Redis pub/sub is not configured.
   */
  private async emitEvent(event: DomainWorkerEvent): Promise<void> {
    // Sanitize error messages to prevent API key leakage
    const sanitizedEvent = {
      ...event,
      error: event.error ? sanitizeErrorMessage(event.error) : undefined,
    };

    if (this.eventPublisher) {
      try {
        const subscriberCount = await this.eventPublisher.publishWorkerEvent(
          event.projectId,
          sanitizedEvent
        );

        // Log outcome with subscriber count (useful for debugging)
        if (subscriberCount === null) {
          // Null indicates publish failure (per IWorkerEventPublisher interface)
          console.error('Failed to publish worker event (publisher returned null)');
          console.log('Worker event (Redis failed):', sanitizedEvent);
        } else if (subscriberCount > 0) {
          console.log(`Worker event published to ${subscriberCount} subscriber(s):`, sanitizedEvent);
        } else {
          // 0 subscribers, but publication succeeded (expected if CLI not connected yet)
          console.log('Worker event published (no subscribers):', sanitizedEvent);
        }
      } catch (error) {
        // Redis publish failed, log error but don't throw (worker should continue)
        console.error('Failed to publish worker event:', error);
        console.log('Worker event (Redis failed):', sanitizedEvent);
      }
    } else {
      // No event publisher configured, fallback to console.log
      console.log('Worker event (no publisher):', sanitizedEvent);
    }
  }

  /**
   * Close worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    this.requestQueue.stop();
  }
}

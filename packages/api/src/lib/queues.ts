import { Queue } from 'bullmq';
import { redis } from './redis.js';
import { logger } from './logger.js';

/**
 * Queue names
 */
export const QUEUE_NAMES = {
  DOMAIN: 'domain', // Main domain queue for worker (CHECK, REGISTER, RENEW, etc.)
  DOMAIN_CHECK: 'domain-check',
  PROJECT_INIT: 'project-init',
  SERVICE_PROVISION: 'service-provision',
  DNS_CHECK: 'dns-check',
  DNS_FIX: 'dns-fix',
  GITHUB: 'github', // GitHub worker queue
  CLOUDFLARE: 'cloudflare', // Cloudflare worker queue
  DNS: 'dns', // DNS wiring worker queue
} as const;

/**
 * Create BullMQ queues with proper typing
 *
 * SECURITY: Stack 4 - Job cleanup configuration
 * Jobs are automatically removed after completion/failure to:
 * - Prevent Redis memory exhaustion
 * - Remove any residual sensitive data
 * - Comply with data retention policies
 */
function createQueues(): Record<string, Queue> | Record<string, never> {
  if (!redis) {
    logger.warn('Redis not available - queues will not be created');
    return {};
  }

  // Use full redis.options to preserve authentication, TLS, DB index, etc.
  // This ensures BullMQ connects with the same credentials as the ioredis instance
  const connection = redis.options;

  // Default job options for all queues
  // SECURITY: Keep last 100 completed and 200 failed jobs for debugging
  // Older jobs are automatically cleaned up to prevent data accumulation
  const ONE_DAY_IN_SECONDS = 24 * 60 * 60;
  const SEVEN_DAYS_IN_SECONDS = 7 * ONE_DAY_IN_SECONDS;

  const defaultJobOptions = {
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: ONE_DAY_IN_SECONDS, // Remove jobs older than 24 hours
    },
    removeOnFail: {
      count: 200, // Keep last 200 failed jobs for debugging
      age: SEVEN_DAYS_IN_SECONDS, // Remove failed jobs older than 7 days
    },
  };

  return {
    domain: new Queue(QUEUE_NAMES.DOMAIN, { connection, defaultJobOptions }),
    domainCheck: new Queue(QUEUE_NAMES.DOMAIN_CHECK, { connection, defaultJobOptions }),
    projectInit: new Queue(QUEUE_NAMES.PROJECT_INIT, { connection, defaultJobOptions }),
    serviceProvision: new Queue(QUEUE_NAMES.SERVICE_PROVISION, { connection, defaultJobOptions }),
    dnsCheck: new Queue(QUEUE_NAMES.DNS_CHECK, { connection, defaultJobOptions }),
    dnsFix: new Queue(QUEUE_NAMES.DNS_FIX, { connection, defaultJobOptions }),
    github: new Queue(QUEUE_NAMES.GITHUB, { connection, defaultJobOptions }),
    cloudflare: new Queue(QUEUE_NAMES.CLOUDFLARE, { connection, defaultJobOptions }),
    dns: new Queue(QUEUE_NAMES.DNS, { connection, defaultJobOptions }),
  };
}

export const queues = createQueues();

/**
 * Get queue health status with error handling
 */
export async function getQueueHealth() {
  if (!redis) {
    return {
      available: false,
      queues: {},
    };
  }

  const queueHealth: Record<
    string,
    { waiting: number; active: number; completed: number; failed: number } | { error: string }
  > = {};

  for (const [key, queue] of Object.entries(queues)) {
    if (queue) {
      try {
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
        ]);

        queueHealth[key] = { waiting, active, completed, failed };
      } catch (error) {
        logger.error(error, `Failed to get health for queue: ${key}`);
        queueHealth[key] = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  }

  return {
    available: true,
    queues: queueHealth,
  };
}

/**
 * Close all queues
 */
export async function closeQueues(): Promise<void> {
  for (const queue of Object.values(queues)) {
    if (queue) {
      await queue.close();
    }
  }
  logger.info('All queues closed');
}

/**
 * Queue getter functions for orchestrator
 */
export function getDomainQueue(): Queue {
  if (!queues.domain) {
    throw new Error('Domain queue not initialized');
  }
  return queues.domain;
}

export function getGitHubQueue(): Queue {
  if (!queues.github) {
    throw new Error('GitHub queue not initialized');
  }
  return queues.github;
}

export function getCloudflareQueue(): Queue {
  if (!queues.cloudflare) {
    throw new Error('Cloudflare queue not initialized');
  }
  return queues.cloudflare;
}

export function getDNSQueue(): Queue {
  if (!queues.dns) {
    throw new Error('DNS queue not initialized');
  }
  return queues.dns;
}

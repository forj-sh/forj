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
} as const;

/**
 * Create BullMQ queues with proper typing
 */
function createQueues(): Record<string, Queue> | Record<string, never> {
  if (!redis) {
    logger.warn('Redis not available - queues will not be created');
    return {};
  }

  // Use full redis.options to preserve authentication, TLS, DB index, etc.
  // This ensures BullMQ connects with the same credentials as the ioredis instance
  const connection = redis.options;

  return {
    domain: new Queue(QUEUE_NAMES.DOMAIN, { connection }),
    domainCheck: new Queue(QUEUE_NAMES.DOMAIN_CHECK, { connection }),
    projectInit: new Queue(QUEUE_NAMES.PROJECT_INIT, { connection }),
    serviceProvision: new Queue(QUEUE_NAMES.SERVICE_PROVISION, { connection }),
    dnsCheck: new Queue(QUEUE_NAMES.DNS_CHECK, { connection }),
    dnsFix: new Queue(QUEUE_NAMES.DNS_FIX, { connection }),
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

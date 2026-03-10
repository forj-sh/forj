import Redis from 'ioredis';
import { logger } from './logger.js';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  logger.warn('REDIS_URL not set - queue operations will fail');
}

/**
 * Redis connection for BullMQ
 */
export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    })
  : null;

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  if (!redis) {
    return false;
  }

  try {
    await redis.ping();
    logger.info('Redis connection successful');
    return true;
  } catch (error) {
    logger.error(error, 'Redis connection failed');
    return false;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    logger.info('Redis connection closed');
  }
}

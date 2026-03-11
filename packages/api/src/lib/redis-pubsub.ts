/**
 * Redis Pub/Sub client for worker event streaming
 *
 * Stack 1: Redis pub/sub infrastructure for worker events
 *
 * Provides separate Redis connections for publishing and subscribing to worker events.
 * This enables real-time communication between domain workers and SSE endpoints.
 *
 * Channel Naming Convention:
 * - Worker events: `worker:events:{projectId}`
 * - System events: `system:events` (reserved for future use)
 *
 * Architecture:
 * - Separate publisher/subscriber connections (Redis best practice)
 * - Subscriber connection dedicated to receiving events
 * - Publisher connection shared for sending events
 * - Connection pooling with retry strategy
 */

import Redis from 'ioredis';
import type { DomainWorkerEvent } from '@forj/shared';
import { DomainWorkerEventType, DomainOperationType, DomainJobStatus } from '@forj/shared';
import { logger } from './logger.js';

const REDIS_URL = process.env.REDIS_URL;

/**
 * Redis pub/sub configuration
 */
const PUBSUB_CONFIG = {
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: false,
};

/**
 * Channel name for worker events
 */
export function getWorkerEventChannel(projectId: string): string {
  return `worker:events:${projectId}`;
}

/**
 * Redis Pub/Sub client for worker event streaming
 *
 * Manages separate publisher and subscriber connections.
 * Each subscriber gets its own Redis connection (required by ioredis).
 */
export class RedisPubSub {
  private publisher: Redis | null = null;
  private subscribers: Map<string, Redis> = new Map();
  private readonly url: string | null;

  constructor(redisUrl?: string) {
    this.url = redisUrl || REDIS_URL || null;

    if (!this.url) {
      logger.warn('REDIS_URL not set - pub/sub will not work');
    }
  }

  /**
   * Initialize publisher connection (lazy)
   */
  private async getPublisher(): Promise<Redis | null> {
    if (!this.url) {
      return null;
    }

    if (!this.publisher) {
      this.publisher = new Redis(this.url, PUBSUB_CONFIG);

      this.publisher.on('error', (error) => {
        logger.error(error, 'Redis publisher error');
      });

      this.publisher.on('connect', () => {
        logger.debug('Redis publisher connected');
      });
    }

    return this.publisher;
  }

  /**
   * Create a new subscriber connection
   *
   * Each subscriber needs its own Redis connection because ioredis
   * puts connections in subscriber mode, blocking other commands.
   */
  private async createSubscriber(): Promise<Redis | null> {
    if (!this.url) {
      return null;
    }

    const subscriber = new Redis(this.url, PUBSUB_CONFIG);

    subscriber.on('error', (error) => {
      logger.error(error, 'Redis subscriber error');
    });

    subscriber.on('connect', () => {
      logger.debug('Redis subscriber connected');
    });

    return subscriber;
  }

  /**
   * Publish a worker event to a project channel
   *
   * @param projectId - Project ID to publish to
   * @param event - Domain worker event to publish
   * @returns Number of subscribers that received the message, or null if publish failed
   */
  async publishWorkerEvent(
    projectId: string,
    event: DomainWorkerEvent
  ): Promise<number | null> {
    const publisher = await this.getPublisher();

    if (!publisher) {
      logger.warn({ projectId }, 'Cannot publish event - Redis not configured');
      return null;
    }

    const channel = getWorkerEventChannel(projectId);
    const payload = JSON.stringify(event);

    try {
      const subscriberCount = await publisher.publish(channel, payload);

      logger.debug(
        {
          projectId,
          eventType: event.type,
          jobId: event.jobId,
          subscriberCount
        },
        'Published worker event'
      );

      return subscriberCount;
    } catch (error) {
      logger.error(
        error,
        `Failed to publish worker event for project ${projectId} (type: ${event.type})`
      );
      return null;
    }
  }

  /**
   * Subscribe to worker events for a project
   *
   * @param projectId - Project ID to subscribe to
   * @param callback - Function called for each received event
   * @returns Unsubscribe function, or null if subscription failed
   */
  async subscribeWorkerEvents(
    projectId: string,
    callback: (event: DomainWorkerEvent) => void
  ): Promise<(() => Promise<void>) | null> {
    const subscriber = await this.createSubscriber();

    if (!subscriber) {
      logger.warn({ projectId }, 'Cannot subscribe - Redis not configured');
      return null;
    }

    const channel = getWorkerEventChannel(projectId);

    // Store subscriber for cleanup
    // Use Date.now() + random string to prevent collision if multiple subscriptions occur in same millisecond
    const subscriberId = `${projectId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.subscribers.set(subscriberId, subscriber);

    // Set up message handler
    subscriber.on('message', (receivedChannel: string, message: string) => {
      if (receivedChannel !== channel) {
        return;
      }

      try {
        const event = JSON.parse(message) as DomainWorkerEvent;
        callback(event);
      } catch (error) {
        logger.error(
          error,
          `Failed to parse worker event for project ${projectId}`
        );
      }
    });

    // Subscribe to channel
    try {
      await subscriber.subscribe(channel);

      logger.debug({ projectId, channel }, 'Subscribed to worker events');

      // Return unsubscribe function
      return async () => {
        try {
          await subscriber.unsubscribe(channel);
          logger.debug({ projectId, channel }, 'Unsubscribed from worker events');
        } catch (error) {
          logger.error(
            error,
            `Failed to unsubscribe from worker events for project ${projectId}`
          );
        } finally {
          try {
            await subscriber.quit();
          } catch (quitError) {
            logger.error(
              quitError,
              `Failed to quit Redis subscriber during unsubscribe for project ${projectId}`
            );
          } finally {
            this.subscribers.delete(subscriberId);
          }
        }
      };
    } catch (error) {
      logger.error(
        error,
        `Failed to subscribe to worker events for project ${projectId} (channel: ${channel})`
      );

      // Clean up failed subscriber
      await subscriber.quit();
      this.subscribers.delete(subscriberId);

      return null;
    }
  }

  /**
   * Test pub/sub connectivity
   *
   * Publishes a test message and verifies it's received.
   * Useful for health checks and integration tests.
   */
  async testConnection(): Promise<boolean> {
    // Use unique test ID to prevent conflicts if tests run concurrently
    const testProjectId = `test-connection-${Date.now()}`;
    const testEvent: DomainWorkerEvent = {
      type: DomainWorkerEventType.JOB_CREATED,
      jobId: 'test-job',
      projectId: testProjectId,
      operation: DomainOperationType.CHECK,
      status: DomainJobStatus.PENDING,
      timestamp: Date.now(),
    };

    return new Promise(async (resolve) => {
      let unsubscribe: (() => Promise<void>) | null = null;

      const timeout = setTimeout(async () => {
        if (unsubscribe) {
          await unsubscribe();
        }
        resolve(false);
      }, 2000); // 2-second timeout

      unsubscribe = await this.subscribeWorkerEvents(
        testProjectId,
        async (event) => {
          if (event.jobId === testEvent.jobId) {
            clearTimeout(timeout);
            if (unsubscribe) {
              await unsubscribe();
            }
            resolve(true);
          }
        }
      );

      if (!unsubscribe) {
        clearTimeout(timeout);
        resolve(false);
        return;
      }

      await this.publishWorkerEvent(testProjectId, testEvent);
    });
  }

  /**
   * Close all connections
   *
   * Call this when shutting down the server to gracefully
   * close all Redis connections.
   */
  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    // Close publisher
    if (this.publisher) {
      closePromises.push(
        this.publisher.quit().then(() => {
          logger.debug('Redis publisher closed');
        })
      );
      this.publisher = null;
    }

    // Close all subscribers
    for (const [subscriberId, subscriber] of this.subscribers.entries()) {
      closePromises.push(
        subscriber.quit().then(() => {
          logger.debug({ subscriberId }, 'Redis subscriber closed');
        })
      );
    }
    this.subscribers.clear();

    // Use allSettled to ensure all connections are attempted to close even if some fail
    const results = await Promise.allSettled(closePromises);

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(
          result.reason,
          'Failed to close Redis pub/sub connection'
        );
      }
    }

    logger.info('All Redis pub/sub connections closed');
  }
}

/**
 * Singleton instance for the API server
 *
 * Use this instance throughout the API server for pub/sub operations.
 */
export const redisPubSub = new RedisPubSub();

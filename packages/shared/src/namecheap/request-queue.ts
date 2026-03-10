/**
 * Priority queue for Namecheap API requests
 *
 * Reference: project-docs/namecheap-integration-spec.md Section 4.6
 *
 * Manages request prioritization with three levels:
 * - CRITICAL: Registration/renewal (user paid, must succeed)
 * - INTERACTIVE: Availability checks (user waiting in CLI)
 * - BACKGROUND: Pricing cache, monitoring
 *
 * Integrates with RateLimiter to respect Namecheap's 20 req/min limit.
 */

import type { Redis } from 'ioredis';
import type { RateLimiter } from './rate-limiter.js';

/**
 * Request executor function type
 */
export type RequestExecutor<T = any> = (
  command: string,
  params: Record<string, string>
) => Promise<T>;

/**
 * Request priority levels
 */
export enum RequestPriority {
  CRITICAL = 1,    // Registration/renewal - user paid
  INTERACTIVE = 2, // Availability checks - user waiting
  BACKGROUND = 3,  // Pricing cache, monitoring
}

/**
 * Queued request
 */
interface QueuedRequest<T> {
  id: string;
  command: string;
  params: Record<string, string>;
  priority: RequestPriority;
  enqueuedAt: number;
  userId?: string;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
}

/**
 * Queue position information
 */
export interface QueuePosition {
  position: number;
  estimatedWaitMs: number;
  ahead: number;
}

/**
 * Priority queue for Namecheap API requests
 *
 * Uses three in-memory priority queues (one per level) with Redis overflow
 * for persistence across server restarts.
 */
export class NamecheapRequestQueue {
  private readonly rateLimiter: RateLimiter;
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly executor: RequestExecutor;

  // In-memory priority queues
  private readonly queues: Map<RequestPriority, QueuedRequest<any>[]> = new Map([
    [RequestPriority.CRITICAL, []],
    [RequestPriority.INTERACTIVE, []],
    [RequestPriority.BACKGROUND, []],
  ]);

  // Processing state
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(
    rateLimiter: RateLimiter,
    redis: Redis,
    executor: RequestExecutor,
    keyPrefix = 'namecheap'
  ) {
    this.rateLimiter = rateLimiter;
    this.redis = redis;
    this.executor = executor;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Submit a request to the queue
   *
   * @param command - Namecheap API command
   * @param params - Command parameters
   * @param priority - Request priority level
   * @param userId - Optional user ID for fairness tracking
   * @returns Promise that resolves when request is processed
   */
  async submit<T>(
    command: string,
    params: Record<string, string>,
    priority: RequestPriority,
    userId?: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `${Date.now()}:${Math.random().toString(36).substring(7)}`,
        command,
        params,
        priority,
        enqueuedAt: Date.now(),
        userId,
        resolve,
        reject,
      };

      // Add to appropriate priority queue
      const queue = this.queues.get(priority);
      if (!queue) {
        reject(new Error(`Invalid priority: ${priority}`));
        return;
      }

      queue.push(request);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.startProcessing();
      }
    });
  }

  /**
   * Get current queue position for a given priority level
   *
   * @param priority - Request priority level
   * @returns Queue position information
   */
  getQueuePosition(priority: RequestPriority): QueuePosition {
    let ahead = 0;

    // Count all requests ahead of this priority
    for (const [level, queue] of this.queues.entries()) {
      if (level < priority) {
        ahead += queue.length;
      }
    }

    const currentQueue = this.queues.get(priority);
    const position = ahead + (currentQueue?.length || 0);

    // Estimate wait time based on rate limit (20 req/min = 3s per request)
    const estimatedWaitMs = ahead * 3000;

    return {
      position,
      estimatedWaitMs,
      ahead,
    };
  }

  /**
   * Get queue statistics
   *
   * @returns Queue stats per priority level
   */
  async getStats(): Promise<{
    critical: number;
    interactive: number;
    background: number;
    total: number;
    processing: boolean;
  }> {
    const critical = this.queues.get(RequestPriority.CRITICAL)?.length || 0;
    const interactive = this.queues.get(RequestPriority.INTERACTIVE)?.length || 0;
    const background = this.queues.get(RequestPriority.BACKGROUND)?.length || 0;

    return {
      critical,
      interactive,
      background,
      total: critical + interactive + background,
      processing: this.isProcessing,
    };
  }

  /**
   * Start processing queue
   */
  private startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;

    // Process queue every 100ms (check rate limit availability)
    this.processingInterval = setInterval(() => {
      void this.processNext();
    }, 100);
  }

  /**
   * Stop processing queue
   */
  stop(): void {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Process next request from queue
   */
  private async processNext(): Promise<void> {
    // Get next request by priority BEFORE acquiring rate limit
    // This prevents burning rate limit slots when queue is empty
    const request = this.dequeue();

    if (!request) {
      // No requests to process, stop processing
      this.stop();
      return;
    }

    // Try to acquire rate limit slot
    const rateLimitResult = await this.rateLimiter.tryAcquire();

    if (!rateLimitResult.allowed) {
      // Rate limit reached, re-queue the request and wait
      const queue = this.queues.get(request.priority);
      if (queue) {
        queue.unshift(request); // Put back at front
      }
      return;
    }

    // Execute the request using the provided executor
    try {
      const result = await this.executor(request.command, request.params);
      request.resolve(result);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Dequeue next request by priority
   *
   * @returns Next request to process, or null if queue is empty
   */
  private dequeue(): QueuedRequest<any> | null {
    // Check queues in priority order
    for (const priority of [
      RequestPriority.CRITICAL,
      RequestPriority.INTERACTIVE,
      RequestPriority.BACKGROUND,
    ]) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        // Remove and return first request
        return queue.shift() || null;
      }
    }

    return null;
  }

  /**
   * Save queue state to Redis (for persistence across restarts)
   */
  async saveToRedis(): Promise<void> {
    try {
      const state = {
        critical: this.queues.get(RequestPriority.CRITICAL) || [],
        interactive: this.queues.get(RequestPriority.INTERACTIVE) || [],
        background: this.queues.get(RequestPriority.BACKGROUND) || [],
        timestamp: Date.now(),
      };

      await this.redis.set(
        `${this.keyPrefix}:queue:state`,
        JSON.stringify(state),
        'EX',
        3600 // Expire after 1 hour
      );
    } catch (error) {
      console.error('Failed to save queue state to Redis:', error);
    }
  }

  /**
   * Load queue state from Redis (on server restart)
   *
   * Note: Requests loaded from Redis cannot have their resolve/reject handlers
   * restored since functions cannot be serialized. This method logs the count
   * of lost requests and clears the saved state. Callers should handle request
   * timeouts on the client side to detect server restarts.
   */
  async loadFromRedis(): Promise<void> {
    try {
      const stateJson = await this.redis.get(`${this.keyPrefix}:queue:state`);
      if (!stateJson) return;

      const state = JSON.parse(stateJson);

      // Count requests that were lost during restart
      const criticalCount = (state.critical || []).length;
      const interactiveCount = (state.interactive || []).length;
      const backgroundCount = (state.background || []).length;
      const totalLost = criticalCount + interactiveCount + backgroundCount;

      if (totalLost > 0) {
        console.warn(
          `Queue restart: ${totalLost} requests lost (${criticalCount} critical, ${interactiveCount} interactive, ${backgroundCount} background). ` +
          'Clients should detect timeouts and retry.'
        );
      }

      // Clear saved state (cannot restore requests without handlers)
      await this.redis.del(`${this.keyPrefix}:queue:state`);
    } catch (error) {
      console.error('Failed to load queue state from Redis:', error);
    }
  }

  /**
   * Clear all queues (for testing)
   */
  clearAll(): void {
    for (const queue of this.queues.values()) {
      // Reject all pending requests
      for (const request of queue) {
        request.reject(new Error('Queue cleared'));
      }
      queue.length = 0;
    }
  }
}

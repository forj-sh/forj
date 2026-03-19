/**
 * Priority queue for Namecheap API requests
 *
 * Reference: docs/namecheap-integration.md Section 4.6
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
import { QueueEventEmitter } from './queue-events.js';

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
  public readonly events: QueueEventEmitter;

  // In-memory priority queues
  private readonly queues: Map<RequestPriority, QueuedRequest<any>[]> = new Map([
    [RequestPriority.CRITICAL, []],
    [RequestPriority.INTERACTIVE, []],
    [RequestPriority.BACKGROUND, []],
  ]);

  // Fairness tracking: userId -> count of pending requests
  private readonly userRequestCounts: Map<string, number> = new Map();

  // Metrics tracking
  private totalEnqueued = 0;
  private totalProcessed = 0;
  private totalFailed = 0;

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
    this.events = new QueueEventEmitter();
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
      this.totalEnqueued++;

      // Track user request count for fairness
      if (userId) {
        this.userRequestCounts.set(userId, (this.userRequestCounts.get(userId) || 0) + 1);
      }

      // Emit enqueued event (guarded to prevent listener exceptions)
      try {
        const position = this.getQueuePosition(priority);
        this.events.emitEnqueued({
          requestId: request.id,
          command,
          priority,
          userId,
          position,
        });
      } catch (emitError) {
        console.error('Error in enqueued event listener:', emitError);
      }

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
    totalEnqueued: number;
    totalProcessed: number;
    totalFailed: number;
    utilizationPercent: number;
  }> {
    const critical = this.queues.get(RequestPriority.CRITICAL)?.length || 0;
    const interactive = this.queues.get(RequestPriority.INTERACTIVE)?.length || 0;
    const background = this.queues.get(RequestPriority.BACKGROUND)?.length || 0;
    const total = critical + interactive + background;

    // Calculate utilization based on rate limiter
    const rateLimitStats = await this.rateLimiter.getStats();

    return {
      critical,
      interactive,
      background,
      total,
      processing: this.isProcessing,
      totalEnqueued: this.totalEnqueued,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      utilizationPercent: rateLimitStats.utilizationPercent,
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
   * Decrement user request count after processing
   */
  private decrementUserRequestCount(userId?: string): void {
    if (!userId) return;

    const count = this.userRequestCounts.get(userId) || 0;
    if (count <= 1) {
      this.userRequestCounts.delete(userId);
    } else {
      this.userRequestCounts.set(userId, count - 1);
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

    const startTime = Date.now();
    const waitTimeMs = startTime - request.enqueuedAt;

    // Emit processing event (guarded to prevent listener exceptions from breaking queue)
    try {
      this.events.emitProcessing({
        requestId: request.id,
        command: request.command,
        priority: request.priority,
        userId: request.userId,
        waitTimeMs,
      });
    } catch (emitError) {
      // Listener threw - log but don't break request processing
      console.error('Error in processing event listener:', emitError);
    }

    // Execute the request using the provided executor
    try {
      const result = await this.executor(request.command, request.params);
      request.resolve(result);

      const processingTimeMs = Date.now() - startTime;
      this.totalProcessed++;

      // Decrement user request count
      this.decrementUserRequestCount(request.userId);

      // Emit completed event (guarded to prevent listener exceptions)
      try {
        this.events.emitCompleted({
          requestId: request.id,
          command: request.command,
          priority: request.priority,
          userId: request.userId,
          processingTimeMs,
        });
      } catch (emitError) {
        console.error('Error in completed event listener:', emitError);
      }
    } catch (error) {
      this.totalFailed++;

      // Decrement user request count
      this.decrementUserRequestCount(request.userId);

      // Emit failed event (guarded to prevent listener exceptions)
      try {
        this.events.emitFailed({
          requestId: request.id,
          command: request.command,
          priority: request.priority,
          userId: request.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (emitError) {
        console.error('Error in failed event listener:', emitError);
      }

      request.reject(error instanceof Error ? error : new Error(String(error)));
    }

    // Emit metrics update (guarded to prevent unhandled rejections)
    try {
      const stats = await this.getStats();
      this.events.emitMetricsUpdate({
        metrics: {
          critical: stats.critical,
          interactive: stats.interactive,
          background: stats.background,
          total: stats.total,
          processing: stats.processing,
          utilizationPercent: stats.utilizationPercent,
        },
      });
    } catch (statsError) {
      // getStats() or emit failed - avoid unhandled promise rejection
      console.error('Error emitting queue metrics update:', statsError);
    }
  }

  /**
   * Dequeue next request by priority with fairness
   *
   * Selects the next request from the user with the fewest pending requests
   * within the current priority level. System requests (without userId) are
   * served immediately.
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
      if (!queue || queue.length === 0) continue;

      // If only one request, return it
      if (queue.length === 1) {
        return queue.shift() || null;
      }

      // Find user with fewest pending requests (fairness)
      let minCount = Infinity;
      let minIndex = 0;

      for (let i = 0; i < queue.length; i++) {
        const request = queue[i];
        const userId = request.userId;

        if (userId === undefined || userId === null) {
          // No user ID, serve immediately (system requests)
          return queue.splice(i, 1)[0];
        }

        const count = this.userRequestCounts.get(userId) || 0;
        if (count < minCount) {
          minCount = count;
          minIndex = i;
        }
      }

      // Remove and return request with fewest pending requests
      return queue.splice(minIndex, 1)[0];
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

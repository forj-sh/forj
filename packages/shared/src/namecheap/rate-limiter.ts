/**
 * Redis-backed sliding window rate limiter for Namecheap API
 *
 * Reference: docs/namecheap-integration.md Section 4.5
 *
 * Namecheap enforces ~20 API requests per minute. This rate limiter uses
 * a Redis sorted set to track requests in a sliding 60-second window.
 */

import type { Redis } from 'ioredis';

/**
 * Logger interface for rate limiter errors
 */
export interface RateLimiterLogger {
  error(message: string, error?: unknown): void;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  redis: Redis;
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Redis key prefix for rate limiter data */
  keyPrefix: string;
  /** Optional logger for error reporting (defaults to console) */
  logger?: RateLimiterLogger;
}

/**
 * Rate limiter result
 */
export interface RateLimitResult {
  /** Whether the request was allowed */
  allowed: boolean;
  /** Current count in the window */
  currentCount: number;
  /** Remaining requests in the window */
  remaining: number;
  /** Time until window reset (ms) */
  resetMs: number;
}

/**
 * Redis-backed sliding window rate limiter
 *
 * Uses a sorted set where:
 * - Score = timestamp (ms)
 * - Member = unique request ID (timestamp:random)
 *
 * This allows efficient cleanup of old entries and accurate counting
 * within the sliding window.
 */
export class RateLimiter {
  private readonly redis: Redis;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly redisKey: string;
  private readonly logger: RateLimiterLogger;

  constructor(config: RateLimiterConfig) {
    this.redis = config.redis;
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
    this.redisKey = `${config.keyPrefix}:rate_limit:window`;
    this.logger = config.logger || console;
  }

  /**
   * Try to acquire a rate limit slot
   *
   * @returns Rate limit result with allowed status and remaining count
   */
  async tryAcquire(): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Use a Lua script for atomic operations
    // This ensures the check-and-increment happens atomically
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local maxRequests = tonumber(ARGV[3])
      local requestId = ARGV[4]
      local windowMs = tonumber(ARGV[5])

      -- Remove expired entries
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

      -- Count current requests in window
      local currentCount = redis.call('ZCARD', key)

      -- Check if under limit
      if currentCount < maxRequests then
        -- Add this request
        redis.call('ZADD', key, now, requestId)
        -- Set expiry on the key (cleanup) - derive from windowMs
        -- Use 2x window to ensure data persists across sliding window
        local ttlSeconds = math.ceil(windowMs / 1000) * 2
        redis.call('EXPIRE', key, ttlSeconds)
        return {1, currentCount + 1}
      else
        return {0, currentCount}
      end
    `;

    const requestId = `${now}:${Math.random().toString(36).substring(7)}`;

    try {
      const result = await this.redis.eval(
        script,
        1,
        this.redisKey,
        now.toString(),
        windowStart.toString(),
        this.maxRequests.toString(),
        requestId,
        this.windowMs.toString()
      ) as [number, number];

      const allowed = result[0] === 1;
      const currentCount = result[1];
      const remaining = Math.max(0, this.maxRequests - currentCount);

      // Calculate time until oldest request expires
      const resetMs = await this.getResetTime();

      return {
        allowed,
        currentCount,
        remaining,
        resetMs,
      };
    } catch (error) {
      // If Redis fails, fail open (allow the request) to prevent total outage
      // Log the error for monitoring
      this.logger.error('Rate limiter Redis error:', error);
      return {
        allowed: true,
        currentCount: 0,
        remaining: this.maxRequests,
        resetMs: this.windowMs,
      };
    }
  }

  /**
   * Get current count in the window (without acquiring)
   *
   * @returns Number of requests in the current window
   */
  async getCurrentCount(): Promise<number> {
    try {
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Remove expired entries first
      await this.redis.zremrangebyscore(this.redisKey, 0, windowStart);

      // Count remaining entries
      const count = await this.redis.zcard(this.redisKey);
      return count;
    } catch (error) {
      this.logger.error('Rate limiter getCurrentCount error:', error);
      return 0;
    }
  }

  /**
   * Get time until the window resets (oldest request expires)
   *
   * @returns Milliseconds until reset
   */
  async getResetTime(): Promise<number> {
    try {
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Remove expired entries first to get accurate reset time
      await this.redis.zremrangebyscore(this.redisKey, 0, windowStart);

      // Get the oldest entry in the window
      const oldest = await this.redis.zrange(this.redisKey, 0, 0, 'WITHSCORES');

      if (oldest.length >= 2) {
        const oldestTimestamp = parseFloat(oldest[1]);
        const resetTime = oldestTimestamp + this.windowMs - now;
        return Math.max(0, resetTime);
      }

      // No entries, next request will start a new window
      return this.windowMs;
    } catch (error) {
      this.logger.error('Rate limiter getResetTime error:', error);
      return this.windowMs;
    }
  }

  /**
   * Clear all rate limit data (for testing)
   */
  async clear(): Promise<void> {
    try {
      await this.redis.del(this.redisKey);
    } catch (error) {
      this.logger.error('Rate limiter clear error:', error);
    }
  }

  /**
   * Get rate limiter statistics
   *
   * @returns Stats object with current count, remaining, and utilization
   */
  async getStats(): Promise<{
    currentCount: number;
    maxRequests: number;
    remaining: number;
    utilizationPercent: number;
    resetMs: number;
  }> {
    const currentCount = await this.getCurrentCount();
    const remaining = Math.max(0, this.maxRequests - currentCount);
    const utilizationPercent = (currentCount / this.maxRequests) * 100;
    const resetMs = await this.getResetTime();

    return {
      currentCount,
      maxRequests: this.maxRequests,
      remaining,
      utilizationPercent,
      resetMs,
    };
  }
}

/**
 * Create a Namecheap API rate limiter instance
 *
 * @param redis - Redis client
 * @returns Configured rate limiter for Namecheap (20 req/min)
 */
export function createNamecheapRateLimiter(redis: Redis): RateLimiter {
  return new RateLimiter({
    redis,
    maxRequests: 20,
    windowMs: 60000, // 60 seconds
    keyPrefix: 'namecheap',
  });
}

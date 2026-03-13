/**
 * Per-IP rate limiter for API routes
 *
 * Uses Redis-backed sliding window to track requests per IP address.
 * Protects against distributed attacks and credential stuffing.
 * Works independently of authentication (can protect unauthenticated endpoints).
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { logger } from './logger.js';

/**
 * Rate limit configuration for an endpoint
 */
export interface IpRateLimitConfig {
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/**
 * Rate limiter result
 */
export interface IpRateLimitResult {
  /** Whether the request was allowed */
  allowed: boolean;
  /** Current count in the window */
  currentCount: number;
  /** Remaining requests in the window */
  remaining: number;
  /** Time until window reset (ms) */
  resetMs: number;
  /** Time until window reset (seconds, for Retry-After header) */
  resetSeconds: number;
}

/**
 * Per-IP rate limiter using Redis sorted sets with sliding window
 *
 * Pattern: ip:{ipAddress}:ratelimit:{endpoint}
 * Sorted set: score = timestamp, member = requestId
 *
 * NOTE: IP addresses are normalized (IPv6 addresses lowercased, IPv4 preserved)
 */
export class IpRateLimiter {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Normalize IP address for consistent storage
   * - IPv6: lowercase
   * - IPv4: preserve as-is
   */
  private normalizeIp(ip: string): string {
    // IPv6 addresses should be lowercased for consistency
    if (ip.includes(':')) {
      return ip.toLowerCase();
    }
    return ip;
  }

  /**
   * Get Redis key for an IP and endpoint
   */
  private getKey(ip: string, endpoint: string): string {
    const normalizedIp = this.normalizeIp(ip);
    return `ip:${normalizedIp}:ratelimit:${endpoint}`;
  }

  /**
   * Try to acquire a rate limit slot for an IP address
   *
   * @param ip - IP address (IPv4 or IPv6)
   * @param endpoint - Endpoint identifier (e.g., "auth-login", "provision")
   * @param config - Rate limit configuration
   * @returns Rate limit result
   */
  async tryAcquire(
    ip: string,
    endpoint: string,
    config: IpRateLimitConfig
  ): Promise<IpRateLimitResult> {
    // Validate configuration
    if (config.windowMs <= 0) {
      throw new Error('windowMs must be greater than 0');
    }
    if (config.maxRequests <= 0) {
      throw new Error('maxRequests must be greater than 0');
    }

    const key = this.getKey(ip, endpoint);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Lua script for atomic check-and-increment
    // Returns: [allowed (0|1), currentCount, oldestTimestamp]
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
      local allowed = currentCount < maxRequests

      if allowed then
        -- Add this request
        redis.call('ZADD', key, now, requestId)
        -- Set expiry (2x window for cleanup)
        local ttlSeconds = math.ceil(windowMs / 1000) * 2
        redis.call('EXPIRE', key, ttlSeconds)
        currentCount = currentCount + 1
      end

      -- Get oldest entry to calculate reset time
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local oldestTimestamp = 0
      if #oldest >= 2 then
        oldestTimestamp = tonumber(oldest[2])
      end

      return {allowed and 1 or 0, currentCount, oldestTimestamp}
    `;

    const requestId = randomUUID();

    try {
      const result = (await this.redis.eval(
        script,
        1,
        key,
        now.toString(),
        windowStart.toString(),
        config.maxRequests.toString(),
        requestId,
        config.windowMs.toString()
      )) as [number, number, number];

      const allowed = result[0] === 1;
      const currentCount = result[1];
      const oldestTimestamp = result[2];
      const remaining = Math.max(0, config.maxRequests - currentCount);

      // Calculate reset time from oldest timestamp
      const resetMs =
        oldestTimestamp > 0
          ? Math.max(0, oldestTimestamp + config.windowMs - now)
          : config.windowMs;
      const resetSeconds = Math.ceil(resetMs / 1000);

      return {
        allowed,
        currentCount,
        remaining,
        resetMs,
        resetSeconds,
      };
    } catch (error) {
      // Fail open on Redis errors (allow request but log error)
      logger.error({ error, ip, endpoint }, 'IP rate limiter Redis error');
      return {
        allowed: true,
        currentCount: 0,
        remaining: config.maxRequests,
        resetMs: config.windowMs,
        resetSeconds: Math.ceil(config.windowMs / 1000),
      };
    }
  }

  /**
   * Get time until window resets (oldest entry expires)
   *
   * Note: Assumes cleanup has already been done by caller
   */
  private async getResetTime(key: string, windowMs: number): Promise<number> {
    try {
      const now = Date.now();

      // Get oldest entry (cleanup should already be done by caller)
      const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');

      if (oldest.length >= 2) {
        const oldestTimestamp = parseFloat(oldest[1]);
        const resetTime = oldestTimestamp + windowMs - now;
        return Math.max(0, resetTime);
      }

      // No entries, next request starts new window
      return windowMs;
    } catch (error) {
      logger.error({ error, key }, 'Failed to get reset time');
      return windowMs;
    }
  }

  /**
   * Get current request count for an IP (without acquiring)
   */
  async getCurrentCount(ip: string, endpoint: string, windowMs: number): Promise<number> {
    try {
      const key = this.getKey(ip, endpoint);
      const now = Date.now();
      const windowStart = now - windowMs;

      // Remove expired entries
      await this.redis.zremrangebyscore(key, 0, windowStart);

      // Count remaining
      const count = await this.redis.zcard(key);
      return count;
    } catch (error) {
      logger.error({ error, ip, endpoint }, 'Failed to get current count');
      return 0;
    }
  }

  /**
   * Clear rate limit data for an IP (for testing/admin purposes)
   */
  async clear(ip: string, endpoint: string): Promise<void> {
    try {
      const key = this.getKey(ip, endpoint);
      await this.redis.del(key);
    } catch (error) {
      logger.error({ error, ip, endpoint }, 'Failed to clear rate limit data');
    }
  }

  /**
   * Get stats for an IP's rate limit
   */
  async getStats(
    ip: string,
    endpoint: string,
    config: IpRateLimitConfig
  ): Promise<{
    currentCount: number;
    maxRequests: number;
    remaining: number;
    utilizationPercent: number;
    resetMs: number;
  }> {
    // Validate configuration
    if (config.windowMs <= 0) {
      throw new Error('windowMs must be greater than 0');
    }
    if (config.maxRequests <= 0) {
      throw new Error('maxRequests must be greater than 0');
    }

    const currentCount = await this.getCurrentCount(ip, endpoint, config.windowMs);
    const remaining = Math.max(0, config.maxRequests - currentCount);
    const utilizationPercent = (currentCount / config.maxRequests) * 100;
    const resetMs = await this.getResetTime(this.getKey(ip, endpoint), config.windowMs);

    return {
      currentCount,
      maxRequests: config.maxRequests,
      remaining,
      utilizationPercent,
      resetMs,
    };
  }
}

/**
 * Default IP rate limit configurations for different endpoints
 *
 * These are more restrictive than per-user limits to prevent distributed attacks
 */
export const DEFAULT_IP_RATE_LIMITS: Record<string, IpRateLimitConfig> = {
  // Authentication endpoints (prevent credential stuffing)
  'auth-login': {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 5 attempts per 15 minutes
  },

  'auth-register': {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000, // 3 registrations per hour
  },

  // Provisioning (expensive operations)
  provision: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000, // 5 provisions per hour
  },

  // Domain checks (less expensive but still worth rate limiting)
  'domains-check': {
    maxRequests: 30,
    windowMs: 60 * 60 * 1000, // 30 checks per hour
  },

  // API operations (moderate)
  'api-keys': {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 10 operations per hour
  },

  // Default for unspecified endpoints (moderate)
  default: {
    maxRequests: 50,
    windowMs: 60 * 60 * 1000, // 50 requests per hour
  },
};

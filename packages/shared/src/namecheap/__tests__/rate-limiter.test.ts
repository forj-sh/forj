/**
 * Unit tests for Redis-backed rate limiter
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RateLimiter, createNamecheapRateLimiter, type RateLimiterLogger } from '../rate-limiter.js';
import type { Redis } from 'ioredis';

// Mock Redis client
const createMockRedis = (): jest.Mocked<Redis> => ({
  eval: jest.fn(),
  zremrangebyscore: jest.fn(),
  zcard: jest.fn(),
  zrange: jest.fn(),
  del: jest.fn(),
} as any);

// Mock logger
const createMockLogger = (): jest.Mocked<RateLimiterLogger> => ({
  error: jest.fn(),
});

describe('RateLimiter', () => {
  let mockRedis: jest.Mocked<Redis>;
  let mockLogger: jest.Mocked<RateLimiterLogger>;
  let limiter: RateLimiter;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockLogger = createMockLogger();
    limiter = new RateLimiter({
      redis: mockRedis,
      maxRequests: 20,
      windowMs: 60000,
      keyPrefix: 'test',
      logger: mockLogger,
    });
  });

  describe('tryAcquire', () => {
    it('should allow request when under limit', async () => {
      // Mock Lua script to return [1, 5] (allowed, currentCount)
      mockRedis.eval.mockResolvedValueOnce([1, 5]);
      mockRedis.zrange.mockResolvedValueOnce(['req1', '1000000']);

      const result = await limiter.tryAcquire();

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(5);
      expect(result.remaining).toBe(15);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('should deny request when at limit', async () => {
      // Mock Lua script to return [0, 20] (denied, currentCount)
      mockRedis.eval.mockResolvedValueOnce([0, 20]);
      mockRedis.zrange.mockResolvedValueOnce(['req1', '1000000']);

      const result = await limiter.tryAcquire();

      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(20);
      expect(result.remaining).toBe(0);
    });

    it('should pass windowMs to Lua script for TTL calculation', async () => {
      mockRedis.eval.mockResolvedValueOnce([1, 1]);
      mockRedis.zrange.mockResolvedValueOnce([]);

      await limiter.tryAcquire();

      // Verify windowMs is passed as 5th argument (ARGV[5] in Lua)
      const evalArgs = (mockRedis.eval as jest.Mock).mock.calls[0];
      expect(evalArgs[6]).toBe('60000'); // windowMs as string
    });

    it('should fail open on Redis error', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await limiter.tryAcquire();

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
      expect(result.remaining).toBe(20);
      expect(result.resetMs).toBe(60000);
      expect(mockLogger.error).toHaveBeenCalledWith('Rate limiter Redis error:', expect.any(Error));
    });

    it('should use console when no logger provided', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const limiterNoLogger = new RateLimiter({
        redis: mockRedis,
        maxRequests: 20,
        windowMs: 60000,
        keyPrefix: 'test',
      });

      mockRedis.eval.mockRejectedValueOnce(new Error('Redis error'));

      await limiterNoLogger.tryAcquire();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getCurrentCount', () => {
    it('should return current count after cleanup', async () => {
      mockRedis.zremrangebyscore.mockResolvedValueOnce(2);
      mockRedis.zcard.mockResolvedValueOnce(10);

      const count = await limiter.getCurrentCount();

      expect(count).toBe(10);
      expect(mockRedis.zremrangebyscore).toHaveBeenCalledTimes(1);
      expect(mockRedis.zcard).toHaveBeenCalledTimes(1);
    });

    it('should return 0 on Redis error', async () => {
      mockRedis.zremrangebyscore.mockRejectedValueOnce(new Error('Redis error'));

      const count = await limiter.getCurrentCount();

      expect(count).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith('Rate limiter getCurrentCount error:', expect.any(Error));
    });
  });

  describe('getResetTime', () => {
    it('should return time until oldest request expires', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000; // 30 seconds ago

      mockRedis.zremrangebyscore.mockResolvedValueOnce(0);
      mockRedis.zrange.mockResolvedValueOnce(['req1', oldestTimestamp.toString()]);

      const resetMs = await limiter.getResetTime();

      // Should reset in ~30 seconds (60s window - 30s elapsed)
      expect(resetMs).toBeGreaterThan(29000);
      expect(resetMs).toBeLessThan(31000);
      expect(mockRedis.zremrangebyscore).toHaveBeenCalledTimes(1);
    });

    it('should return windowMs when no entries exist', async () => {
      mockRedis.zremrangebyscore.mockResolvedValueOnce(0);
      mockRedis.zrange.mockResolvedValueOnce([]);

      const resetMs = await limiter.getResetTime();

      expect(resetMs).toBe(60000);
    });

    it('should prune expired entries before reading', async () => {
      const now = Date.now();
      const windowStart = now - 60000;

      mockRedis.zremrangebyscore.mockResolvedValueOnce(5);
      mockRedis.zrange.mockResolvedValueOnce(['req1', now.toString()]);

      await limiter.getResetTime();

      // Verify pruning was called with correct window start
      const pruneArgs = (mockRedis.zremrangebyscore as jest.Mock).mock.calls[0];
      expect(pruneArgs[0]).toBe('test:rate_limit:window');
      expect(pruneArgs[1]).toBe(0);
      expect(Math.abs(pruneArgs[2] - windowStart)).toBeLessThan(100); // Allow small timing variance
    });

    it('should return windowMs on Redis error', async () => {
      mockRedis.zremrangebyscore.mockRejectedValueOnce(new Error('Redis error'));

      const resetMs = await limiter.getResetTime();

      expect(resetMs).toBe(60000);
      expect(mockLogger.error).toHaveBeenCalledWith('Rate limiter getResetTime error:', expect.any(Error));
    });
  });

  describe('clear', () => {
    it('should delete the Redis key', async () => {
      mockRedis.del.mockResolvedValueOnce(1);

      await limiter.clear();

      expect(mockRedis.del).toHaveBeenCalledWith('test:rate_limit:window');
    });

    it('should log error on Redis failure', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('Redis error'));

      await limiter.clear();

      expect(mockLogger.error).toHaveBeenCalledWith('Rate limiter clear error:', expect.any(Error));
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValueOnce(15);
      mockRedis.zrange.mockResolvedValueOnce(['req1', '1000000']);

      const stats = await limiter.getStats();

      expect(stats.currentCount).toBe(15);
      expect(stats.maxRequests).toBe(20);
      expect(stats.remaining).toBe(5);
      expect(stats.utilizationPercent).toBe(75);
      expect(stats.resetMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty window', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValueOnce(0);
      mockRedis.zrange.mockResolvedValueOnce([]);

      const stats = await limiter.getStats();

      expect(stats.currentCount).toBe(0);
      expect(stats.remaining).toBe(20);
      expect(stats.utilizationPercent).toBe(0);
      expect(stats.resetMs).toBe(60000);
    });
  });
});

describe('createNamecheapRateLimiter', () => {
  it('should create limiter with Namecheap defaults', () => {
    const mockRedis = createMockRedis();
    const limiter = createNamecheapRateLimiter(mockRedis);

    expect(limiter).toBeInstanceOf(RateLimiter);
  });

  it('should use 20 requests per 60 seconds', async () => {
    const mockRedis = createMockRedis();
    const limiter = createNamecheapRateLimiter(mockRedis);

    mockRedis.eval.mockResolvedValueOnce([1, 1]);
    mockRedis.zrange.mockResolvedValueOnce([]);

    const result = await limiter.tryAcquire();

    // Verify maxRequests and windowMs are passed to Lua script
    const evalArgs = (mockRedis.eval as jest.Mock).mock.calls[0];
    expect(evalArgs[5]).toBe('20'); // maxRequests
    expect(evalArgs[6]).toBe('60000'); // windowMs
  });
});

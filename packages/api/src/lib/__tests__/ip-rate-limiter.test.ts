/**
 * Unit tests for IpRateLimiter
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Redis } from 'ioredis';
import { IpRateLimiter, type IpRateLimitConfig } from '../ip-rate-limiter.js';

describe('IpRateLimiter', () => {
  let mockRedis: jest.Mocked<Redis>;
  let rateLimiter: IpRateLimiter;

  const testConfig: IpRateLimitConfig = {
    maxRequests: 5,
    windowMs: 60000, // 1 minute
  };

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      eval: jest.fn<any>(),
      zremrangebyscore: jest.fn<any>(),
      zrange: jest.fn<any>(),
      zcard: jest.fn<any>(),
      del: jest.fn<any>(),
    } as any;

    rateLimiter = new IpRateLimiter(mockRedis);
  });

  describe('tryAcquire()', () => {
    it('should allow request when under limit', async () => {
      const now = Date.now();
      // Lua script returns [1, 1, oldestTimestamp] = allowed, currentCount=1
      mockRedis.eval.mockResolvedValue([1, 1, now]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(1);
      expect(result.remaining).toBe(4);
      expect(result.resetMs).toBeGreaterThan(0);
      expect(result.resetSeconds).toBeGreaterThan(0);
    });

    it('should block request when at limit', async () => {
      const now = Date.now();
      // Lua script returns [0, 5, oldestTimestamp] = blocked, currentCount=5
      mockRedis.eval.mockResolvedValue([0, 5, now - 30000]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);

      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(5);
      expect(result.remaining).toBe(0);
    });

    it('should block request when over limit', async () => {
      const now = Date.now();
      // Lua script returns [0, 6, oldestTimestamp] = blocked, currentCount=6
      mockRedis.eval.mockResolvedValue([0, 6, now - 30000]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);

      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(6);
      expect(result.remaining).toBe(0);
    });

    it('should use correct Redis key format for IPv4', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      await rateLimiter.tryAcquire('192.168.1.100', 'provision', testConfig);

      // Check that eval was called with correct key
      expect(mockRedis.eval).toHaveBeenCalled();
      const evalCall = mockRedis.eval.mock.calls[0];
      const key = evalCall[2]; // Third argument is the key
      expect(key).toBe('ip:192.168.1.100:ratelimit:provision');
    });

    it('should normalize IPv6 addresses to lowercase', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      // Mixed case IPv6
      await rateLimiter.tryAcquire('2001:0DB8:AC10:FE01::1', 'provision', testConfig);

      expect(mockRedis.eval).toHaveBeenCalled();
      const evalCall = mockRedis.eval.mock.calls[0];
      const key = evalCall[2];
      expect(key).toBe('ip:2001:0db8:ac10:fe01::1:ratelimit:provision');
    });

    it('should handle IPv6 loopback address', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      await rateLimiter.tryAcquire('::1', 'auth-login', testConfig);

      const key = mockRedis.eval.mock.calls[0][2];
      expect(key).toBe('ip:::1:ratelimit:auth-login');
    });

    it('should pass correct parameters to Lua script', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      const now = Date.now();
      await rateLimiter.tryAcquire('10.0.0.1', 'auth-login', testConfig);

      expect(mockRedis.eval).toHaveBeenCalled();
      const evalCall = mockRedis.eval.mock.calls[0];

      // Arguments: script, numKeys, key, now, windowStart, maxRequests, requestId, windowMs
      expect(evalCall[1]).toBe(1); // numKeys
      expect(evalCall[2]).toBe('ip:10.0.0.1:ratelimit:auth-login'); // key
      expect(parseInt(evalCall[3] as string)).toBeGreaterThanOrEqual(now - 100); // now
      expect(evalCall[5]).toBe('5'); // maxRequests
      expect(evalCall[7]).toBe('60000'); // windowMs
    });

    it('should fail open on Redis error', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis connection failed'));

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
      expect(result.remaining).toBe(testConfig.maxRequests);
    });

    it('should handle different endpoints independently', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);
      await rateLimiter.tryAcquire('192.168.1.1', 'provision', testConfig);

      // Should have been called twice with different keys
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
      const key1 = mockRedis.eval.mock.calls[0][2];
      const key2 = mockRedis.eval.mock.calls[1][2];
      expect(key1).toBe('ip:192.168.1.1:ratelimit:auth-login');
      expect(key2).toBe('ip:192.168.1.1:ratelimit:provision');
    });

    it('should handle different IPs independently', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);
      await rateLimiter.tryAcquire('192.168.1.2', 'auth-login', testConfig);

      // Should have been called twice with different keys
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
      const key1 = mockRedis.eval.mock.calls[0][2];
      const key2 = mockRedis.eval.mock.calls[1][2];
      expect(key1).toBe('ip:192.168.1.1:ratelimit:auth-login');
      expect(key2).toBe('ip:192.168.1.2:ratelimit:auth-login');
    });

    it('should handle X-Forwarded-For format IPs', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      // IP with port or extra whitespace (common in X-Forwarded-For)
      await rateLimiter.tryAcquire('  203.0.113.195  ', 'auth-login', testConfig);

      const key = mockRedis.eval.mock.calls[0][2];
      // IP should be used as-is (trimming happens in middleware)
      expect(key).toContain('203.0.113.195');
    });
  });

  describe('getCurrentCount()', () => {
    it('should return current request count', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(2);
      mockRedis.zcard.mockResolvedValue(3);

      const count = await rateLimiter.getCurrentCount('192.168.1.1', 'auth-login', testConfig.windowMs);

      expect(count).toBe(3);
      expect(mockRedis.zremrangebyscore).toHaveBeenCalledWith(
        'ip:192.168.1.1:ratelimit:auth-login',
        0,
        expect.any(Number)
      );
      expect(mockRedis.zcard).toHaveBeenCalledWith('ip:192.168.1.1:ratelimit:auth-login');
    });

    it('should return 0 on Redis error', async () => {
      mockRedis.zremrangebyscore.mockRejectedValue(new Error('Redis error'));

      const count = await rateLimiter.getCurrentCount('192.168.1.1', 'auth-login', testConfig.windowMs);

      expect(count).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should delete rate limit data for IP', async () => {
      mockRedis.del.mockResolvedValue(1);

      await rateLimiter.clear('192.168.1.1', 'auth-login');

      expect(mockRedis.del).toHaveBeenCalledWith('ip:192.168.1.1:ratelimit:auth-login');
    });

    it('should not throw on Redis error', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      await expect(rateLimiter.clear('192.168.1.1', 'auth-login')).resolves.not.toThrow();
    });
  });

  describe('getStats()', () => {
    it('should return comprehensive statistics', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000; // 30 seconds ago

      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(3);
      mockRedis.zrange.mockResolvedValue(['req1', oldestTimestamp.toString()]);

      const stats = await rateLimiter.getStats('192.168.1.1', 'auth-login', testConfig);

      expect(stats.currentCount).toBe(3);
      expect(stats.maxRequests).toBe(5);
      expect(stats.remaining).toBe(2);
      expect(stats.utilizationPercent).toBe(60); // 3/5 * 100
      expect(stats.resetMs).toBeGreaterThan(0);
    });

    it('should handle full utilization', async () => {
      const now = Date.now();
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(5);
      mockRedis.zrange.mockResolvedValue(['req1', now.toString()]);

      const stats = await rateLimiter.getStats('192.168.1.1', 'auth-login', testConfig);

      expect(stats.currentCount).toBe(5);
      expect(stats.remaining).toBe(0);
      expect(stats.utilizationPercent).toBe(100);
    });

    it('should handle over-utilization', async () => {
      const now = Date.now();
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(7);
      mockRedis.zrange.mockResolvedValue(['req1', now.toString()]);

      const stats = await rateLimiter.getStats('192.168.1.1', 'auth-login', testConfig);

      expect(stats.currentCount).toBe(7);
      expect(stats.remaining).toBe(0); // Not negative
      expect(stats.utilizationPercent).toBe(140); // 7/5 * 100
    });

    it('should handle zero utilization', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(0);
      mockRedis.zrange.mockResolvedValue([]);

      const stats = await rateLimiter.getStats('192.168.1.1', 'auth-login', testConfig);

      expect(stats.currentCount).toBe(0);
      expect(stats.remaining).toBe(5);
      expect(stats.utilizationPercent).toBe(0);
    });
  });

  describe('Sliding window behavior', () => {
    it('should calculate reset time based on oldest entry', async () => {
      const now = Date.now();
      const oldestTimestamp = now - 30000; // 30 seconds ago

      // Lua script returns oldestTimestamp as third value
      mockRedis.eval.mockResolvedValue([1, 1, oldestTimestamp]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);

      // Reset should be ~30 seconds (when oldest entry expires)
      expect(result.resetMs).toBeGreaterThan(29000);
      expect(result.resetMs).toBeLessThan(31000);
      expect(result.resetSeconds).toBeGreaterThan(29);
      expect(result.resetSeconds).toBeLessThan(31);
    });

    it('should use window size when no entries exist', async () => {
      // Lua script returns 0 for oldestTimestamp when no entries
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', testConfig);

      // Reset should be full window (60 seconds)
      expect(result.resetMs).toBeGreaterThanOrEqual(testConfig.windowMs - 1000);
      expect(result.resetSeconds).toBeGreaterThanOrEqual(Math.ceil(testConfig.windowMs / 1000) - 1);
    });
  });

  describe('Edge cases', () => {
    it('should handle very high limits', async () => {
      const highLimitConfig: IpRateLimitConfig = {
        maxRequests: 10000,
        windowMs: 60000,
      };

      mockRedis.eval.mockResolvedValue([1, 5000, 0]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', highLimitConfig);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5000);
    });

    it('should handle very short windows', async () => {
      const shortWindowConfig: IpRateLimitConfig = {
        maxRequests: 5,
        windowMs: 1000, // 1 second
      };

      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      const result = await rateLimiter.tryAcquire('192.168.1.1', 'auth-login', shortWindowConfig);

      expect(result.allowed).toBe(true);
      expect(result.resetSeconds).toBeLessThanOrEqual(2);
    });

    it('should handle localhost IPv4', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      await rateLimiter.tryAcquire('127.0.0.1', 'auth-login', testConfig);

      const key = mockRedis.eval.mock.calls[0][2];
      expect(key).toBe('ip:127.0.0.1:ratelimit:auth-login');
    });

    it('should handle localhost IPv6', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      await rateLimiter.tryAcquire('::1', 'auth-login', testConfig);

      const key = mockRedis.eval.mock.calls[0][2];
      expect(key).toBe('ip:::1:ratelimit:auth-login');
    });

    it('should handle IPv4-mapped IPv6 addresses', async () => {
      mockRedis.eval.mockResolvedValue([1, 1, 0]);

      // IPv4-mapped IPv6 (::ffff:192.0.2.1)
      await rateLimiter.tryAcquire('::ffff:192.0.2.1', 'auth-login', testConfig);

      const key = mockRedis.eval.mock.calls[0][2];
      expect(key).toBe('ip:::ffff:192.0.2.1:ratelimit:auth-login');
    });

    it('should reject invalid config with windowMs <= 0', async () => {
      const invalidConfig: IpRateLimitConfig = {
        maxRequests: 5,
        windowMs: 0,
      };

      await expect(
        rateLimiter.tryAcquire('192.168.1.1', 'auth-login', invalidConfig)
      ).rejects.toThrow('windowMs must be greater than 0');
    });

    it('should reject invalid config with maxRequests <= 0', async () => {
      const invalidConfig: IpRateLimitConfig = {
        maxRequests: 0,
        windowMs: 60000,
      };

      await expect(
        rateLimiter.tryAcquire('192.168.1.1', 'auth-login', invalidConfig)
      ).rejects.toThrow('maxRequests must be greater than 0');
    });
  });

  describe('Security scenarios', () => {
    it('should rate limit aggressive credential stuffing attempts', async () => {
      const authConfig: IpRateLimitConfig = {
        maxRequests: 5,
        windowMs: 15 * 60 * 1000, // 5 attempts per 15 minutes
      };

      // Simulate 5 attempts - all should succeed
      for (let i = 0; i < 5; i++) {
        mockRedis.eval.mockResolvedValue([1, i + 1, 0]);

        const result = await rateLimiter.tryAcquire('192.168.1.100', 'auth-login', authConfig);
        expect(result.allowed).toBe(true);
      }

      // 6th attempt should be blocked
      mockRedis.eval.mockResolvedValue([0, 5, Date.now()]);

      const result = await rateLimiter.tryAcquire('192.168.1.100', 'auth-login', authConfig);
      expect(result.allowed).toBe(false);
    });

    it('should isolate different IPs during attack', async () => {
      // Attacker IP
      mockRedis.eval.mockResolvedValueOnce([0, 5, Date.now()]); // Blocked
      const attacker = await rateLimiter.tryAcquire('203.0.113.100', 'auth-login', testConfig);
      expect(attacker.allowed).toBe(false);

      // Legitimate user IP should not be affected
      mockRedis.eval.mockResolvedValueOnce([1, 1, 0]); // Allowed
      const legitimate = await rateLimiter.tryAcquire('203.0.113.50', 'auth-login', testConfig);
      expect(legitimate.allowed).toBe(true);
    });
  });
});

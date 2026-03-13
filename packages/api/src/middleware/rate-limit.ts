/**
 * Per-user rate limiting middleware
 *
 * Integrates with UserRateLimiter to enforce rate limits on API routes
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRateLimiter, DEFAULT_RATE_LIMITS, type RateLimitConfig } from '../lib/user-rate-limiter.js';
import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Rate limit middleware factory
 *
 * @param endpoint - Endpoint identifier (e.g., "provision", "api-keys")
 * @param config - Optional rate limit configuration (defaults to DEFAULT_RATE_LIMITS[endpoint] or default)
 * @returns Fastify preHandler middleware
 *
 * @example
 * server.post('/provision', {
 *   preHandler: [requireAuth, rateLimit('provision')]
 * }, handler);
 *
 * @example
 * server.get('/domains/check', {
 *   preHandler: [requireAuth, rateLimit('domains-check', { maxRequests: 100, windowMs: 60000 })]
 * }, handler);
 */
export function rateLimit(endpoint: string, config?: RateLimitConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Rate limiting requires authentication to identify user
    if (!request.user) {
      logger.warn({ endpoint }, 'Rate limit middleware called without authentication');
      // Allow request to continue if not authenticated (auth middleware will handle rejection)
      return;
    }

    const redis = getRedis();

    // If Redis is unavailable, fail open (allow request but log warning)
    if (!redis) {
      logger.warn({ endpoint, userId: request.user.userId }, 'Rate limiting skipped - Redis unavailable');
      return;
    }

    const userId = request.user.userId;
    const rateLimiter = new UserRateLimiter(redis);

    // Use provided config or default for endpoint
    const effectiveConfig = config || DEFAULT_RATE_LIMITS[endpoint] || DEFAULT_RATE_LIMITS.default;

    try {
      const result = await rateLimiter.tryAcquire(userId, endpoint, effectiveConfig);

      // Set standard rate limit headers
      reply.header('X-RateLimit-Limit', effectiveConfig.maxRequests.toString());
      reply.header('X-RateLimit-Remaining', result.remaining.toString());
      reply.header('X-RateLimit-Reset', result.resetSeconds.toString());

      if (!result.allowed) {
        // Rate limit exceeded - return 429 Too Many Requests
        reply.header('Retry-After', result.resetSeconds.toString());

        logger.warn({
          userId,
          endpoint,
          currentCount: result.currentCount,
          maxRequests: effectiveConfig.maxRequests,
          resetSeconds: result.resetSeconds,
        }, 'Rate limit exceeded');

        return reply.status(429).send({
          success: false,
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            limit: effectiveConfig.maxRequests,
            remaining: 0,
            resetSeconds: result.resetSeconds,
            retryAfter: result.resetSeconds,
          },
        });
      }

      // Rate limit check passed - allow request to continue
      logger.debug({
        userId,
        endpoint,
        currentCount: result.currentCount,
        remaining: result.remaining,
      }, 'Rate limit check passed');
    } catch (error) {
      // Fail open on errors (allow request but log error)
      logger.error({
        error,
        userId,
        endpoint,
      }, 'Rate limit check failed - allowing request');
    }
  };
}

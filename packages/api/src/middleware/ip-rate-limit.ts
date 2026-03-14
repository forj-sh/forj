/**
 * Per-IP rate limiting middleware
 *
 * Integrates with IpRateLimiter to enforce rate limits per IP address.
 * Works independently of authentication - protects both authenticated and unauthenticated endpoints.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { IpRateLimiter, DEFAULT_IP_RATE_LIMITS, type IpRateLimitConfig } from '../lib/ip-rate-limiter.js';
import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Extract client IP address from request
 *
 * SECURITY: Stack 6 - Proper proxy trust handling
 *
 * When behind Cloudflare (production):
 * - Uses CF-Connecting-IP header (cannot be spoofed)
 * - Falls back to request.ip (Fastify processes X-Forwarded-For when trustProxy enabled)
 *
 * When direct connection (development):
 * - Uses request.ip only (ignores X-Forwarded-For to prevent spoofing)
 *
 * @param request - Fastify request
 * @returns Client IP address (IPv4 or IPv6)
 */
export function getClientIp(request: FastifyRequest): string {
  // When behind Cloudflare, use CF-Connecting-IP header
  // This header is set by Cloudflare and cannot be spoofed by the client
  const cfConnectingIp = request.headers['cf-connecting-ip'];
  if (cfConnectingIp && typeof cfConnectingIp === 'string') {
    return cfConnectingIp;
  }

  // Fall back to request.ip
  // When trustProxy is enabled, Fastify correctly parses X-Forwarded-For
  // When trustProxy is disabled, request.ip is the direct connection IP
  return request.ip;
}

/**
 * IP rate limit middleware factory
 *
 * @param endpoint - Endpoint identifier (e.g., "auth-login", "provision")
 * @param config - Optional rate limit configuration (defaults to DEFAULT_IP_RATE_LIMITS[endpoint] or default)
 * @returns Fastify preHandler middleware
 *
 * @example
 * // Protect auth login from credential stuffing
 * server.post('/auth/login', {
 *   preHandler: [ipRateLimit('auth-login')]
 * }, handler);
 *
 * @example
 * // Custom rate limit
 * server.get('/public-api', {
 *   preHandler: [ipRateLimit('public-api', { maxRequests: 100, windowMs: 60000 })]
 * }, handler);
 *
 * @example
 * // Combine with user rate limiting for layered protection
 * server.post('/provision', {
 *   preHandler: [requireAuth, ipRateLimit('provision'), rateLimit('provision')]
 * }, handler);
 */
export function ipRateLimit(endpoint: string, config?: IpRateLimitConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const redis = getRedis();

    // If Redis is unavailable, fail open (allow request but log warning)
    if (!redis) {
      logger.warn({ endpoint }, 'IP rate limiting skipped - Redis unavailable');
      return;
    }

    const ip = getClientIp(request);
    const rateLimiter = new IpRateLimiter(redis);

    // Use provided config or default for endpoint
    const effectiveConfig = config || DEFAULT_IP_RATE_LIMITS[endpoint] || DEFAULT_IP_RATE_LIMITS.default;

    try {
      const result = await rateLimiter.tryAcquire(ip, endpoint, effectiveConfig);

      // Set IP-specific rate limit headers (distinct from per-user headers)
      reply.header('X-IpRateLimit-Limit', effectiveConfig.maxRequests.toString());
      reply.header('X-IpRateLimit-Remaining', result.remaining.toString());
      reply.header('X-IpRateLimit-Reset', result.resetSeconds.toString());

      if (!result.allowed) {
        // Rate limit exceeded - return 429 Too Many Requests
        reply.header('Retry-After', result.resetSeconds.toString());

        logger.warn({
          ip,
          endpoint,
          currentCount: result.currentCount,
          maxRequests: effectiveConfig.maxRequests,
          resetSeconds: result.resetSeconds,
        }, 'IP rate limit exceeded');

        return reply.status(429).send({
          success: false,
          error: 'Rate limit exceeded',
          code: 'IP_RATE_LIMIT_EXCEEDED',
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
        ip,
        endpoint,
        currentCount: result.currentCount,
        remaining: result.remaining,
      }, 'IP rate limit check passed');
    } catch (error) {
      // Fail open on errors (allow request but log error)
      logger.error({
        error,
        ip,
        endpoint,
      }, 'IP rate limit check failed - allowing request');
    }
  };
}

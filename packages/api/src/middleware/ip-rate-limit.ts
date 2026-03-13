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
 * Considers X-Forwarded-For header for requests behind proxies/load balancers.
 * Falls back to request.ip if no proxy headers present.
 *
 * SECURITY: In production, ensure your reverse proxy (e.g., nginx, Cloudflare)
 * sets X-Forwarded-For correctly and strips client-provided values.
 *
 * @param request - Fastify request
 * @returns Client IP address (IPv4 or IPv6)
 */
export function getClientIp(request: FastifyRequest): string {
  // Check X-Forwarded-For header (set by reverse proxies)
  const forwardedFor = request.headers['x-forwarded-for'];

  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
    // The first IP is the original client
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
    const clientIp = ips[0].trim();
    return clientIp;
  }

  // Fall back to request.ip (direct connection or trusted proxy)
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

      // Set standard rate limit headers
      reply.header('X-RateLimit-Limit', effectiveConfig.maxRequests.toString());
      reply.header('X-RateLimit-Remaining', result.remaining.toString());
      reply.header('X-RateLimit-Reset', result.resetSeconds.toString());

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

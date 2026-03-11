/**
 * Authentication middleware
 *
 * Verifies JWT tokens and attaches user information to requests.
 *
 * Stack 6: Basic auth middleware (JWT verification)
 *
 * SECURITY NOTE:
 * - JWT secret must be set in JWT_SECRET environment variable
 * - Tokens expire after 30 days (configurable)
 * - This middleware should be applied to all protected routes
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import type { TokenPayload } from '@forj/shared';

/**
 * User information attached to request after authentication
 */
export interface RequestUser {
  userId: string;
  email: string;
}

/**
 * Augment Fastify request type to include user property
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser;
  }
}

/**
 * Authentication middleware
 *
 * Verifies JWT token from Authorization header and attaches user info to request.
 *
 * Usage:
 * ```typescript
 * server.get('/protected', { preHandler: requireAuth }, async (request, reply) => {
 *   const userId = request.user!.userId;
 *   // ...
 * });
 * ```
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({
      success: false,
      error: 'Missing authorization header',
      code: 'UNAUTHORIZED',
    });
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : authHeader;

  if (!token) {
    return reply.status(401).send({
      success: false,
      error: 'Missing authentication token',
      code: 'UNAUTHORIZED',
    });
  }

  // Get JWT secret from environment
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    request.log.error('JWT_SECRET not configured');
    return reply.status(500).send({
      success: false,
      error: 'Authentication not configured',
      code: 'SERVER_ERROR',
    });
  }

  try {
    // Verify JWT token
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    // Extract user info from token payload with runtime validation
    const { userId, email } = payload;

    if (typeof userId !== 'string' || typeof email !== 'string') {
      request.log.warn({ payload }, 'Invalid token payload structure');
      return reply.status(401).send({
        success: false,
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN',
      });
    }

    // Attach user info to request
    request.user = {
      userId,
      email,
    };

    // Continue to route handler
  } catch (error) {
    if (error instanceof Error) {
      request.log.debug({ error: error.message }, 'Token verification failed');
    }

    return reply.status(401).send({
      success: false,
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
    });
  }
}

/**
 * Optional authentication middleware
 *
 * Similar to requireAuth, but doesn't fail if no token is provided.
 * Useful for routes that have optional authentication (e.g., public + authenticated access).
 */
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  // If no auth header, just continue (request.user will be undefined)
  if (!authHeader) {
    return;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : authHeader;

  if (!token) {
    return;
  }

  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    request.log.warn('JWT_SECRET not configured for optional auth');
    return;
  }

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    // Extract user info from token payload with runtime validation
    const { userId, email } = payload;

    if (typeof userId === 'string' && typeof email === 'string') {
      request.user = {
        userId,
        email,
      };
    }
  } catch (error) {
    // Silently ignore invalid tokens for optional auth
    request.log.debug({ error }, 'Optional auth token verification failed');
  }
}

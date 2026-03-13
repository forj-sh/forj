/**
 * Authentication middleware
 *
 * Verifies JWT tokens and API keys, attaching user information to requests.
 *
 * Stack 6: Basic auth middleware (JWT verification)
 * Stack 2 (Phase 6): API key authentication support
 *
 * SECURITY NOTE:
 * - JWT secret must be set in JWT_SECRET environment variable
 * - Tokens expire after 30 days (configurable)
 * - API keys are verified using bcrypt and stored in database
 * - This middleware should be applied to all protected routes
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import type { TokenPayload } from '@forj/shared';
import { ApiKeyService, type ApiKeyScope } from '../lib/api-key-service.js';
import { db } from '../lib/database.js';

/**
 * Singleton ApiKeyService instance (lazy-initialized)
 */
let apiKeyService: ApiKeyService | null = null;

function getApiKeyService(): ApiKeyService {
  if (!apiKeyService) {
    apiKeyService = new ApiKeyService(db);
  }
  return apiKeyService;
}

/**
 * Set a custom API key service (for testing)
 * @internal
 */
export function _setApiKeyService(service: ApiKeyService | null): void {
  apiKeyService = service;
}

/**
 * User information attached to request after authentication
 */
export interface RequestUser {
  userId: string;
  email: string;
  scopes?: ApiKeyScope[]; // Only present for API key auth
  authMethod: 'jwt' | 'api_key';
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
 * Verifies JWT token or API key from Authorization header and attaches user info to request.
 * Supports both authentication methods:
 * - JWT tokens (for user-facing authentication)
 * - API keys (for agent/programmatic access)
 *
 * Usage:
 * ```typescript
 * server.get('/protected', { preHandler: requireAuth }, async (request, reply) => {
 *   const userId = request.user!.userId;
 *   const scopes = request.user!.scopes; // Only present for API key auth
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

  // Determine authentication method based on token format
  const isApiKey = token.startsWith('forj_');

  if (isApiKey) {
    // API Key authentication
    try {
      const service = getApiKeyService();
      const result = await service.verifyApiKey(token);

      if (!result.valid || !result.keyRecord) {
        request.log.debug({ error: result.error }, 'API key verification failed');
        return reply.status(401).send({
          success: false,
          error: result.error || 'Invalid or revoked API key',
          code: 'INVALID_API_KEY',
        });
      }

      // Validate scopes from database to ensure they're valid
      let validatedScopes: ApiKeyScope[];
      try {
        validatedScopes = service.validateScopes(result.keyRecord.scopes);
      } catch (error) {
        request.log.error({
          keyId: result.keyRecord.id,
          scopes: result.keyRecord.scopes,
          error
        }, 'Invalid scopes in database for API key');
        return reply.status(500).send({
          success: false,
          error: 'API key has invalid scopes',
          code: 'SERVER_ERROR',
        });
      }

      // Attach user info from API key record
      request.user = {
        userId: result.keyRecord.user_id,
        email: '', // API keys don't have associated email
        scopes: validatedScopes,
        authMethod: 'api_key',
      };

      request.log.debug({
        userId: result.keyRecord.user_id,
        keyId: result.keyRecord.id,
        scopes: validatedScopes,
      }, 'API key authentication successful');

      return; // Continue to route handler
    } catch (error) {
      request.log.error({ error }, 'API key verification error');
      return reply.status(500).send({
        success: false,
        error: 'Authentication error',
        code: 'SERVER_ERROR',
      });
    }
  } else {
    // JWT authentication
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
        authMethod: 'jwt',
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
        authMethod: 'jwt',
      };
    }
  } catch (error) {
    // Silently ignore invalid tokens for optional auth
    request.log.debug({ error }, 'Optional auth token verification failed');
  }
}

/**
 * Scope-based authorization middleware factory
 *
 * Creates a middleware that requires specific scopes for API key authentication.
 * For JWT authentication, this middleware passes through (JWT users have full access).
 *
 * Usage:
 * ```typescript
 * server.post('/provision', {
 *   preHandler: [requireAuth, requireScopes(['agent:provision'])]
 * }, async (request, reply) => {
 *   // Only API keys with agent:provision scope can access this route
 * });
 * ```
 */
export function requireScopes(requiredScopes: ApiKeyScope[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // User must be authenticated (enforced by requireAuth)
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    // JWT users have full access (no scope restrictions)
    if (request.user.authMethod === 'jwt') {
      return;
    }

    // For API key auth, check scopes
    const userScopes = request.user.scopes || [];
    const hasRequiredScopes = requiredScopes.every((scope) =>
      userScopes.includes(scope)
    );

    if (!hasRequiredScopes) {
      request.log.warn({
        userId: request.user.userId,
        requiredScopes,
        userScopes,
      }, 'Insufficient scopes for API key');

      return reply.status(403).send({
        success: false,
        error: 'Insufficient permissions',
        code: 'FORBIDDEN',
        details: {
          required: requiredScopes,
          provided: userScopes,
        },
      });
    }

    // User has required scopes, continue
  };
}

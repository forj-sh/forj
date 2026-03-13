import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import {
  ApiKeyService,
  ApiKeyNotFoundError,
  ApiKeyRevokedError,
  type ApiKeyScope,
} from '../lib/api-key-service.js';
import { db } from '../lib/database.js';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';
import { rateLimit } from '../middleware/rate-limit.js';

/**
 * Request/Response types
 */
interface CreateApiKeyRequest {
  name?: string;
  scopes: string[];
  expiresAt?: string; // ISO 8601 date string
  environment?: 'live' | 'test';
}

interface CreateApiKeyResponse {
  id: string;
  key: string; // Only returned once!
  name: string | null;
  scopes: ApiKeyScope[];
  createdAt: string;
  expiresAt: string | null;
  environment: 'live' | 'test';
}

interface ListApiKeysResponse {
  keys: Array<{
    id: string;
    name: string | null;
    scopes: ApiKeyScope[];
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }>;
}

/**
 * API key management routes
 *
 * All routes require authentication (JWT or API key).
 * Users can only manage their own API keys.
 */
export async function apiKeyRoutes(server: FastifyInstance) {
  const apiKeyService = new ApiKeyService(db);

  /**
   * POST /api-keys
   * Create a new API key
   */
  server.post<{ Body: CreateApiKeyRequest }>(
    '/api-keys',
    { preHandler: [requireAuth, ipRateLimit('api-keys'), rateLimit('api-keys')] },
    async (request, reply) => {
      const { name, scopes, expiresAt, environment = 'live' } = request.body || {};
      const userId = request.user!.userId;

      // Only JWT users can create API keys (prevents privilege escalation)
      if (request.user!.authMethod !== 'jwt') {
        return reply.status(403).send({
          success: false,
          error: 'API keys cannot be used to create new API keys',
          code: 'FORBIDDEN',
        });
      }

      // Validate request
      if (!scopes || scopes.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'At least one scope is required',
          code: 'INVALID_REQUEST',
        });
      }

      // Validate environment
      if (environment !== 'live' && environment !== 'test') {
        return reply.status(400).send({
          success: false,
          error: 'Environment must be either "live" or "test"',
          code: 'INVALID_REQUEST',
        });
      }

      // Validate scopes
      try {
        apiKeyService.validateScopes(scopes);
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Invalid scopes',
          code: 'INVALID_SCOPES',
        });
      }

      // Parse expiration date if provided
      let expirationDate: Date | undefined;
      if (expiresAt) {
        expirationDate = new Date(expiresAt);
        if (isNaN(expirationDate.getTime())) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid expiration date format (use ISO 8601)',
            code: 'INVALID_DATE',
          });
        }

        // Check if expiration is in the past
        if (expirationDate < new Date()) {
          return reply.status(400).send({
            success: false,
            error: 'Expiration date must be in the future',
            code: 'INVALID_DATE',
          });
        }
      }

      try {
        const result = await apiKeyService.createApiKey({
          userId,
          scopes: scopes as ApiKeyScope[],
          name,
          expiresAt: expirationDate,
          environment,
        });

        const response: CreateApiKeyResponse = {
          id: result.id,
          key: result.key, // IMPORTANT: Only returned once!
          name: result.name,
          scopes: result.scopes,
          createdAt: result.createdAt.toISOString(),
          expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
          environment,
        };

        request.log.info({
          userId,
          keyId: result.id,
          scopes: result.scopes,
          environment,
        }, 'API key created');

        return reply.status(201).send({
          success: true,
          data: response,
        });
      } catch (error) {
        request.log.error({ error, userId }, 'Failed to create API key');
        return reply.status(500).send({
          success: false,
          error: 'Failed to create API key',
          code: 'SERVER_ERROR',
        });
      }
    }
  );

  /**
   * GET /api-keys
   * List all API keys for the authenticated user
   *
   * Query params:
   * - includeRevoked: boolean (default: false)
   */
  server.get<{ Querystring: { includeRevoked?: string } }>(
    '/api-keys',
    { preHandler: [requireAuth, ipRateLimit('api-keys'), rateLimit('api-keys')] },
    async (request, reply) => {
      const userId = request.user!.userId;
      const includeRevoked = request.query.includeRevoked === 'true';

      try {
        const keys = await apiKeyService.listApiKeys(userId, includeRevoked);

        const response: ListApiKeysResponse = {
          keys: keys.map((key) => ({
            id: key.id,
            name: key.name,
            scopes: key.scopes as ApiKeyScope[],
            createdAt: key.created_at.toISOString(),
            expiresAt: key.expires_at ? key.expires_at.toISOString() : null,
            lastUsedAt: key.last_used_at ? key.last_used_at.toISOString() : null,
            revokedAt: key.revoked_at ? key.revoked_at.toISOString() : null,
          })),
        };

        return {
          success: true,
          data: response,
        };
      } catch (error) {
        request.log.error({ error, userId }, 'Failed to list API keys');
        return reply.status(500).send({
          success: false,
          error: 'Failed to list API keys',
          code: 'SERVER_ERROR',
        });
      }
    }
  );

  /**
   * GET /api-keys/:id
   * Get a specific API key by ID
   */
  server.get<{ Params: { id: string } }>(
    '/api-keys/:id',
    { preHandler: [requireAuth, ipRateLimit('api-keys'), rateLimit('api-keys')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.userId;

      try {
        const key = await apiKeyService.getApiKey(id, userId);

        if (!key) {
          return reply.status(404).send({
            success: false,
            error: 'API key not found',
            code: 'NOT_FOUND',
          });
        }

        return {
          success: true,
          data: {
            id: key.id,
            name: key.name,
            scopes: key.scopes as ApiKeyScope[],
            createdAt: key.created_at.toISOString(),
            expiresAt: key.expires_at ? key.expires_at.toISOString() : null,
            lastUsedAt: key.last_used_at ? key.last_used_at.toISOString() : null,
            revokedAt: key.revoked_at ? key.revoked_at.toISOString() : null,
          },
        };
      } catch (error) {
        request.log.error({ error, userId, keyId: id }, 'Failed to get API key');
        return reply.status(500).send({
          success: false,
          error: 'Failed to get API key',
          code: 'SERVER_ERROR',
        });
      }
    }
  );

  /**
   * DELETE /api-keys/:id
   * Revoke an API key (idempotent - returns success if already revoked)
   */
  server.delete<{ Params: { id: string } }>(
    '/api-keys/:id',
    { preHandler: [requireAuth, ipRateLimit('api-keys'), rateLimit('api-keys')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.userId;

      try {
        // Check if key exists first
        const key = await apiKeyService.getApiKey(id, userId);

        if (!key) {
          return reply.status(404).send({
            success: false,
            error: 'API key not found',
            code: 'NOT_FOUND',
          });
        }

        // If already revoked, return success (idempotent)
        if (key.revoked_at) {
          request.log.debug({
            userId,
            keyId: id,
          }, 'API key already revoked (idempotent delete)');

          return {
            success: true,
            data: {
              message: 'API key already revoked',
            },
          };
        }

        // Revoke the key
        const revoked = await apiKeyService.revokeApiKey(id, userId);

        if (!revoked) {
          // This shouldn't happen since we checked existence above
          return reply.status(500).send({
            success: false,
            error: 'Failed to revoke API key',
            code: 'SERVER_ERROR',
          });
        }

        request.log.info({
          userId,
          keyId: id,
        }, 'API key revoked');

        return {
          success: true,
          data: {
            message: 'API key revoked successfully',
          },
        };
      } catch (error) {
        request.log.error({ error, userId, keyId: id }, 'Failed to revoke API key');
        return reply.status(500).send({
          success: false,
          error: 'Failed to revoke API key',
          code: 'SERVER_ERROR',
        });
      }
    }
  );

  /**
   * POST /api-keys/:id/rotate
   * Rotate an API key (revoke old, create new with same scopes)
   *
   * SECURITY: Critical operation - rate limited, audited, atomic
   * The old key is revoked before the new key is returned
   */
  server.post<{ Params: { id: string } }>(
    '/api-keys/:id/rotate',
    { preHandler: [requireAuth, ipRateLimit('api-keys'), rateLimit('api-keys')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.userId;

      try {
        const result = await apiKeyService.rotateApiKey(id, userId);

        request.log.info({
          userId,
          oldKeyId: id,
          newKeyId: result.id,
          scopes: result.scopes,
        }, 'API key rotated');

        return reply.status(201).send({
          success: true,
          data: {
            id: result.id,
            key: result.key, // IMPORTANT: Only returned once!
            name: result.name,
            scopes: result.scopes,
            createdAt: result.createdAt.toISOString(),
            expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
            oldKeyId: result.oldKeyId,
          },
          message: 'API key rotated successfully. Old key has been revoked.',
        });
      } catch (error) {
        // Use custom error classes for robust error handling
        if (error instanceof ApiKeyNotFoundError) {
          return reply.status(404).send({
            success: false,
            error: 'API key not found',
            code: 'NOT_FOUND',
          });
        }

        if (error instanceof ApiKeyRevokedError) {
          return reply.status(400).send({
            success: false,
            error: error.message,
            code: 'INVALID_REQUEST',
          });
        }

        request.log.error({ error, userId, keyId: id }, 'Failed to rotate API key');
        return reply.status(500).send({
          success: false,
          error: 'Failed to rotate API key',
          code: 'SERVER_ERROR',
        });
      }
    }
  );
}

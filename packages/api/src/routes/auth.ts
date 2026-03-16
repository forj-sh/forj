import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import type { CLIAuthRequest, CLIAuthResponse } from '@forj/shared';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';
import { db } from '../lib/database.js';

// Token expiration constants
const ONE_DAY_IN_SECONDS = 24 * 60 * 60; // 86400 seconds

/**
 * Authentication routes
 */
export async function authRoutes(server: FastifyInstance) {
  // Check if mock auth should be registered at all
  const isProduction = process.env.NODE_ENV === 'production';
  const mockAuthEnabled = process.env.ENABLE_MOCK_AUTH === 'true';

  // Only register /auth/cli route if mock auth is explicitly enabled AND not in production
  // This avoids rate limiter running on disabled routes and prevents 500 errors
  if (!isProduction && mockAuthEnabled) {
    /**
     * POST /auth/cli
     * CLI authentication - mock endpoint for development only
     *
     * SECURITY: This endpoint is ONLY registered when ENABLE_MOCK_AUTH=true in development.
     * In production, clients must use /auth/github for GitHub Device Flow authentication.
     *
     * RATE LIMITING: IP-based only (unauthenticated endpoint)
     */
    server.post<{ Body: CLIAuthRequest }>(
      '/auth/cli',
      { preHandler: [ipRateLimit('auth-login')] },
      async (request, reply) => {

        const { deviceId, cliVersion } = request.body || {};

        // Mock user ID with better uniqueness (timestamp + random component)
        const mockUserId = 'mock-user-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        // Generate unique email per user to satisfy UNIQUE constraint on users.email
        const mockEmail = `${mockUserId}@forj.sh`;

        // Create user record in database (required for foreign key constraints on api_keys table)
        // Note: mockUserId is randomized, so ON CONFLICT rarely triggers (not true idempotency)
        try {
          await db.query(
            `INSERT INTO users (id, email, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [mockUserId, mockEmail]
          );
          request.log.debug({ userId: mockUserId }, 'Mock user record created');
        } catch (error) {
          request.log.error({ error, userId: mockUserId }, 'Failed to create mock user record');
          // Continue anyway - user creation is not critical for JWT generation
          // This allows mock auth to work even if database is unavailable
        }

        // Calculate timestamps consistently
        const now = Date.now();
        const iat = Math.floor(now / 1000);
        const exp = iat + ONE_DAY_IN_SECONDS;

        // Get JWT secret from environment
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          return reply.status(500).send({
            success: false,
            error: 'JWT_SECRET not configured',
          });
        }

        // Generate proper JWT token using jose
        const secret = new TextEncoder().encode(jwtSecret);
        const mockToken = await new SignJWT({
          userId: mockUserId,
          email: mockEmail,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(iat)
          .setExpirationTime(exp)
          .sign(secret);

        request.log.warn({
          userId: mockUserId,
          deviceId,
          cliVersion,
        }, '[DEVELOPMENT ONLY] Mock CLI auth request - DO NOT USE IN PRODUCTION');

        const response: CLIAuthResponse = {
          token: mockToken,
          expiresAt: new Date(exp * 1000).toISOString(), // Derive from token's exp claim
          user: {
            id: mockUserId,
            email: mockEmail,
          },
        };

        return {
          success: true,
          data: response,
        };
      }
    );
  } else {
    // Route not registered - log for debugging
    server.log.info({
      isProduction,
      mockAuthEnabled,
    }, 'Mock auth endpoint /auth/cli not registered (disabled or production mode)');
  }
}

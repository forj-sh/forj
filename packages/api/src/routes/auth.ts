import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import type { CLIAuthRequest, CLIAuthResponse } from '@forj/shared';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';

// Token expiration constants
const ONE_DAY_IN_SECONDS = 24 * 60 * 60; // 86400 seconds

/**
 * Authentication routes
 */
export async function authRoutes(server: FastifyInstance) {
  /**
   * POST /auth/cli
   * CLI authentication - mock endpoint for development only
   *
   * SECURITY: This endpoint is DISABLED in production (NODE_ENV=production).
   * In production, clients must use /auth/github for GitHub Device Flow authentication.
   *
   * To enable in development, set ENABLE_MOCK_AUTH=true in .env
   *
   * RATE LIMITING: IP-based only (unauthenticated endpoint)
   */
  server.post<{ Body: CLIAuthRequest }>(
    '/auth/cli',
    { preHandler: [ipRateLimit('auth-login')] },
    async (request, reply) => {
      // SECURITY: Block mock authentication in production
      const isProduction = process.env.NODE_ENV === 'production';
      const mockAuthEnabled = process.env.ENABLE_MOCK_AUTH === 'true';

      if (isProduction || !mockAuthEnabled) {
        request.log.warn({
          nodeEnv: process.env.NODE_ENV,
          mockAuthEnabled,
        }, 'Mock auth endpoint blocked - use GitHub Device Flow');

        return reply.status(404).send({
          success: false,
          error: 'Authentication endpoint not available. Use GitHub Device Flow authentication.',
          hint: 'For development, set ENABLE_MOCK_AUTH=true in .env',
        });
      }

      const { deviceId, cliVersion } = request.body || {};

      // Mock user ID with better uniqueness (timestamp + random component)
      const mockUserId = 'mock-user-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      const mockEmail = 'developer@forj.sh';

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
    });
}

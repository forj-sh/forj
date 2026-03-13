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
   * CLI authentication - returns mock JWT token
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

      request.log.info({
        userId: mockUserId,
        deviceId,
        cliVersion,
      }, 'CLI auth request');

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

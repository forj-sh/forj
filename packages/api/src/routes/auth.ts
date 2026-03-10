import type { FastifyInstance } from 'fastify';
import type { CLIAuthRequest, CLIAuthResponse } from '@forj/shared';

// Token expiration constants
const ONE_DAY_IN_SECONDS = 24 * 60 * 60; // 86400 seconds

/**
 * Authentication routes
 */
export async function authRoutes(server: FastifyInstance) {
  /**
   * POST /auth/cli
   * CLI authentication - returns mock JWT token
   */
  server.post<{ Body: CLIAuthRequest }>('/auth/cli', async (request, reply) => {
    const { deviceId, cliVersion } = request.body || {};

    // Mock user ID with better uniqueness (timestamp + random component)
    const mockUserId = 'mock-user-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const mockEmail = 'developer@forj.sh';

    // Calculate timestamps consistently
    const now = Date.now();
    const iat = Math.floor(now / 1000);
    const exp = iat + ONE_DAY_IN_SECONDS;

    // Mock JWT token (in production, use proper JWT signing)
    const mockToken = Buffer.from(
      JSON.stringify({
        userId: mockUserId,
        email: mockEmail,
        iat,
        exp,
      })
    ).toString('base64');

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

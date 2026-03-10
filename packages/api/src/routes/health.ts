import type { FastifyInstance } from 'fastify';

/**
 * Health check routes
 */
export async function healthRoutes(server: FastifyInstance) {
  /**
   * GET /health
   * Basic health check endpoint
   */
  server.get('/health', async (request, reply) => {
    return {
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
      },
    };
  });

  /**
   * GET /
   * Root endpoint
   */
  server.get('/', async (request, reply) => {
    return {
      success: true,
      data: {
        name: 'Forj API',
        version: '0.1.0',
        description: 'Infrastructure provisioning orchestration API',
      },
    };
  });
}

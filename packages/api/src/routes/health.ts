import type { FastifyInstance } from 'fastify';
import { getDatabaseStatus } from '../lib/database.js';

// Read version from environment or use fallback
const packageVersion = process.env.npm_package_version || '0.1.0';
const packageDescription = process.env.npm_package_description || 'Forj API server';

/**
 * Health check routes
 */
export async function healthRoutes(server: FastifyInstance) {
  /**
   * GET /health
   * Basic health check endpoint with database connectivity
   * Database status is cached for 10 seconds to avoid excessive DB queries
   */
  server.get('/health', async (request, reply) => {
    const dbStatus = await getDatabaseStatus();
    const isHealthy = dbStatus === 'connected' || dbStatus === 'not_configured';

    return {
      success: true,
      data: {
        status: isHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        database: dbStatus,
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
        version: packageVersion,
        description: packageDescription,
      },
    };
  });
}

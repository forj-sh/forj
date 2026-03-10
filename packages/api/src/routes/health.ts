import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDatabaseStatus } from '../lib/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);

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
        version: packageJson.version,
        description: packageJson.description,
      },
    };
  });
}

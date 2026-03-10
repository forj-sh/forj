import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
        version: packageJson.version,
        description: packageJson.description,
      },
    };
  });
}

import { createServer } from './server.js';
import { logger } from './lib/logger.js';
import type { FastifyInstance } from 'fastify';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

let server: FastifyInstance<any, any, any, any> | null = null;

async function start() {
  try {
    server = await createServer();

    await server.listen({ port: PORT, host: HOST });

    logger.info(`Server listening on ${HOST}:${PORT}`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 * Closes Fastify server and allows in-flight requests to complete
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);

  if (server) {
    try {
      await server.close();
      logger.info('Server closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error(error, 'Error during server shutdown');
      process.exit(1);
    }
  } else {
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();

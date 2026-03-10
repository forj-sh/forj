import 'dotenv/config';
import { createServer } from './server.js';
import { logger } from './lib/logger.js';
import type { FastifyInstance } from 'fastify';
import { testConnection, closeDatabase } from './lib/database.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

let server: FastifyInstance<any, any, any, any> | null = null;

async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.warn('Database connection not available - some features may not work');
    }

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
 * Closes Fastify server and database connections
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);

  try {
    // Close server first to stop accepting new requests
    if (server) {
      await server.close();
      logger.info('Server closed successfully');
    }

    // Then close database connections
    await closeDatabase();
  } catch (error) {
    logger.error(error, 'Error during shutdown');
  } finally {
    process.exit(0);
  }
}

// Handle graceful shutdown
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

start();

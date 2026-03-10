import { createServer } from './server.js';
import { logger } from './lib/logger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    const server = await createServer();

    await server.listen({ port: PORT, host: HOST });

    logger.info(`Server listening on ${HOST}:${PORT}`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

start();

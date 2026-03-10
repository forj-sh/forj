import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { queueRoutes } from './routes/queues.js';
import { authRoutes } from './routes/auth.js';
import { domainRoutes } from './routes/domains.js';

/**
 * Create and configure Fastify server
 */
export async function createServer() {
  const server = Fastify({
    logger: logger as any,
    disableRequestLogging: false,
    requestIdLogLabel: 'reqId',
  });

  // Security plugins
  await server.register(helmet, {
    contentSecurityPolicy: false, // Disable CSP for API
  });

  await server.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://forj.sh', 'https://www.forj.sh']
      : true, // Allow all origins in development
    credentials: true,
  });

  // Error handler
  server.setErrorHandler(errorHandler);

  // Routes
  await server.register(healthRoutes);
  await server.register(queueRoutes);
  await server.register(authRoutes);
  await server.register(domainRoutes);

  return server;
}

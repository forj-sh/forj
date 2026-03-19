import 'dotenv/config';
// IMPORTANT: Sentry must be imported before everything else
import './instrument.js';
import { createServer } from './server.js';
import { logger } from './lib/logger.js';
import { isValidEncryptionKey } from './lib/encryption.js';
import type { FastifyInstance } from 'fastify';
import { testConnection, closeDatabase } from './lib/database.js';
import { testRedisConnection, closeRedis } from './lib/redis.js';
import { closeQueues } from './lib/queues.js';
import { webcrypto as nodeWebcrypto } from 'node:crypto';

/**
 * Node 18 does not populate globalThis.crypto by default, but libraries like
 * `jose` rely on the Web Crypto API being available globally. Populate it once
 * at startup to ensure JWT signing works everywhere.
 */
const globalWithCrypto = globalThis as typeof globalThis & { crypto?: typeof nodeWebcrypto };
if (!globalWithCrypto.crypto) {
  globalWithCrypto.crypto = nodeWebcrypto;
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Validate critical environment variables on startup.
 * Fails fast so misconfigurations are caught at deploy time, not at request time.
 */
function validateStartupEnv(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical: auth will not work without these
  if (!process.env.JWT_SECRET) errors.push('JWT_SECRET is not set');
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL is not set');
  if (!process.env.REDIS_URL) errors.push('REDIS_URL is not set');

  // Encryption keys: validate format if set, warn if missing
  for (const key of ['CLOUDFLARE_ENCRYPTION_KEY', 'GITHUB_ENCRYPTION_KEY']) {
    const value = process.env[key];
    if (value && !isValidEncryptionKey(value)) {
      errors.push(`${key} is not a valid 256-bit base64 key`);
    } else if (!value) {
      warnings.push(`${key} is not set — credential storage will fail`);
    }
  }

  // Production-specific checks
  if (isProduction) {
    if (process.env.ENABLE_MOCK_AUTH === 'true') {
      errors.push('ENABLE_MOCK_AUTH must not be "true" in production');
    }
    if (process.env.TRUST_PROXY !== 'true') {
      warnings.push('TRUST_PROXY is not "true" — IP rate limiting may use wrong client IP behind a proxy');
    }
  }

  for (const w of warnings) logger.warn(w);

  if (errors.length > 0) {
    logger.error(`Startup blocked — environment misconfiguration:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
}

let server: FastifyInstance<any, any, any, any> | null = null;

async function start() {
  try {
    // Fail fast on missing or invalid environment variables
    validateStartupEnv();
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.warn('Database connection not available - some features may not work');
    }

    // Test Redis connection
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      logger.warn('Redis connection not available - queue operations will not work');
    }

    server = await createServer();

    await server.listen({ port: PORT, host: HOST });

    logger.info(`Server listening on ${HOST}:${PORT}`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
    if (redisConnected && process.env.ENABLE_BULL_BOARD === 'true') {
      logger.info(`Queue admin UI: http://localhost:${PORT}/queues/admin`);
    }
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 * Closes Fastify server, queues, Redis, and database connections
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);

  try {
    // Close server first to stop accepting new requests
    if (server) {
      await server.close();
      logger.info('Server closed successfully');
    }

    // Then close all connections
    await closeQueues();
    await closeRedis();
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

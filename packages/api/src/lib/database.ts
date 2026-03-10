import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { logger } from './logger.js';

// Configure Neon to use WebSocket for serverless environments
neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  logger.warn('DATABASE_URL not set - database operations will fail');
}

/**
 * Neon Postgres connection pool
 */
export const db = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  if (!DATABASE_URL) {
    return false;
  }

  try {
    const client = await db.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.error(error, 'Database connection failed');
    return false;
  }
}

/**
 * Close all database connections
 */
export async function closeDatabase(): Promise<void> {
  await db.end();
  logger.info('Database connections closed');
}

/**
 * Cached database status for health checks
 */
let cachedDbStatus: {
  status: 'connected' | 'disconnected' | 'not_configured';
  timestamp: number;
} | null = null;

const DB_STATUS_CACHE_TTL = 10000; // 10 seconds

/**
 * Get database connection status with caching
 * Returns: 'connected', 'disconnected', or 'not_configured'
 */
export async function getDatabaseStatus(): Promise<'connected' | 'disconnected' | 'not_configured'> {
  // Return cached status if still valid
  if (cachedDbStatus && Date.now() - cachedDbStatus.timestamp < DB_STATUS_CACHE_TTL) {
    return cachedDbStatus.status;
  }

  let status: 'connected' | 'disconnected' | 'not_configured';

  if (!DATABASE_URL) {
    status = 'not_configured';
  } else {
    try {
      // Use db.query() instead of manual connect/release to avoid connection leaks
      await db.query('SELECT 1');
      status = 'connected';
    } catch (error) {
      logger.error(error, 'Database status check failed');
      status = 'disconnected';
    }
  }

  // Cache the result
  cachedDbStatus = {
    status,
    timestamp: Date.now(),
  };

  return status;
}

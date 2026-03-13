/**
 * Database client for workers
 *
 * Provides lightweight database operations for updating project status
 * from background workers.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import type { ServiceType, ServiceState } from '@forj/shared';

// Configure Neon to use WebSocket for serverless environments
neonConfig.webSocketConstructor = ws;

/**
 * Lazy-initialized database pool
 * Created on first access to ensure DATABASE_URL is loaded from dotenv
 */
let _db: Pool | null = null;

function getDb(): Pool {
  if (!_db) {
    const DATABASE_URL = process.env.DATABASE_URL;

    if (!DATABASE_URL) {
      throw new Error('[Database] DATABASE_URL environment variable is not set');
    }

    _db = new Pool({
      connectionString: DATABASE_URL,
      max: 5, // Smaller pool for workers
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  return _db;
}

/**
 * Update service state for a project
 *
 * Called by workers after job completion/failure to persist status.
 */
export async function updateProjectService(
  projectId: string,
  serviceType: ServiceType,
  state: Partial<ServiceState>
): Promise<void> {
  try {
    const db = getDb();
    // Merge state instead of replacing to preserve existing fields like startedAt
    await db.query(
      `UPDATE projects
       SET services = jsonb_set(
         COALESCE(services, '{}'::jsonb),
         $1,
         (COALESCE(services #> $1, '{}'::jsonb)) || $2::jsonb,
         true
       ),
       updated_at = NOW()
       WHERE id = $3`,
      [`{${serviceType}}`, JSON.stringify(state), projectId]
    );
  } catch (error) {
    console.error(`[Database] Failed to update project service:`, error);
    throw error;
  }
}

/**
 * Close database connections
 */
export async function closeDatabase(): Promise<void> {
  if (_db) {
    await _db.end();
    _db = null;
  }
}

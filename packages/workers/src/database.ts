/**
 * Database client for workers
 *
 * Provides lightweight database operations for updating project status
 * from background workers.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import type { ServiceType, ServiceState } from '@forj/shared';
import { decrypt } from './encryption.js';

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
 * User credentials interface
 */
export interface UserCredentials {
  githubAccessToken?: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
}

/**
 * Fetch and decrypt user credentials from database
 *
 * @param userId - User ID to fetch credentials for
 * @returns Decrypted credentials or null if user not found
 * @throws Error if decryption fails
 */
export async function fetchUserCredentials(userId: string): Promise<UserCredentials | null> {
  try {
    const db = getDb();

    // Get service-specific encryption keys from environment
    const cloudflareEncryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
    const githubEncryptionKey = process.env.GITHUB_ENCRYPTION_KEY;

    if (!cloudflareEncryptionKey) {
      console.error('[Database] CLOUDFLARE_ENCRYPTION_KEY environment variable is not set');
      throw new Error('CLOUDFLARE_ENCRYPTION_KEY environment variable is required');
    }

    if (!githubEncryptionKey) {
      console.error('[Database] GITHUB_ENCRYPTION_KEY environment variable is not set');
      throw new Error('GITHUB_ENCRYPTION_KEY environment variable is required');
    }

    const result = await db.query(
      `SELECT
        github_token_encrypted,
        cloudflare_token_encrypted,
        cloudflare_account_id
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      console.warn(`[Database] User ${userId} not found`);
      return null;
    }

    const row = result.rows[0];
    const credentials: UserCredentials = {};

    // Decrypt GitHub access token if present
    if (row.github_token_encrypted) {
      try {
        credentials.githubAccessToken = await decrypt(
          row.github_token_encrypted,
          githubEncryptionKey
        );
      } catch (error) {
        console.error(`[Database] Failed to decrypt GitHub token for user ${userId}:`, error);
        throw new Error('Failed to decrypt GitHub credentials');
      }
    }

    // Decrypt Cloudflare API token if present
    if (row.cloudflare_token_encrypted) {
      try {
        credentials.cloudflareApiToken = await decrypt(
          row.cloudflare_token_encrypted,
          cloudflareEncryptionKey
        );
      } catch (error) {
        console.error(`[Database] Failed to decrypt Cloudflare token for user ${userId}:`, error);
        throw new Error('Failed to decrypt Cloudflare credentials');
      }
    }

    // Cloudflare account ID is not encrypted
    if (row.cloudflare_account_id) {
      credentials.cloudflareAccountId = row.cloudflare_account_id;
    }

    return credentials;
  } catch (error) {
    console.error(`[Database] Failed to fetch credentials for user ${userId}:`, error);
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

import pg from 'pg';
const { Pool } = pg;
import { logger } from './logger.js';
import type { Project, ServiceState, ServiceType, RegistrantContact, ProjectPhase, StripePaymentStatus } from '@forj/shared';
import { PROJECT_PHASE, STRIPE_PAYMENT_STATUS } from '@forj/shared';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  logger.warn('DATABASE_URL not set - database operations will fail');
}

/**
 * Postgres connection pool
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

/**
 * Project database operations
 */

/**
 * Create a new project
 */
export async function createProject(params: {
  id: string;
  name: string;
  domain: string;
  userId: string;
  services: ServiceType[];
}): Promise<Project> {
  const { id, name, domain, userId, services } = params;

  // Initialize service states as pending with consistent timestamp
  const now = new Date().toISOString();
  const serviceStates: Partial<Record<ServiceType, ServiceState>> = {};
  for (const service of services) {
    serviceStates[service] = {
      status: 'pending',
      startedAt: now,
      updatedAt: now,
    };
  }

  // Normalize domain to lowercase for case-insensitive uniqueness
  const normalizedDomain = domain.toLowerCase();

  const result = await db.query(
    `INSERT INTO projects (id, name, domain, user_id, services, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING id, name, domain, user_id as "userId", services,
               created_at as "createdAt", updated_at as "updatedAt"`,
    [id, name, normalizedDomain, userId, JSON.stringify(serviceStates)]
  );

  return result.rows[0];
}

/**
 * Get project by ID
 */
export async function getProject(projectId: string): Promise<Project | null> {
  const result = await db.query(
    `SELECT id, name, domain, user_id as "userId", services,
            created_at as "createdAt", updated_at as "updatedAt"
     FROM projects
     WHERE id = $1`,
    [projectId]
  );

  return result.rows[0] || null;
}

/**
 * Get project by ID with ownership check
 * Returns null if project doesn't exist or doesn't belong to user
 */
export async function getProjectByIdAndUserId(
  projectId: string,
  userId: string
): Promise<Project | null> {
  const result = await db.query(
    `SELECT id, name, domain, user_id as "userId", services,
            created_at as "createdAt", updated_at as "updatedAt"
     FROM projects
     WHERE id = $1 AND user_id = $2`,
    [projectId, userId]
  );

  return result.rows[0] || null;
}

/**
 * Get all projects for a user
 */
export async function getProjectsByUserId(userId: string): Promise<Project[]> {
  const result = await db.query(
    `SELECT id, name, domain, user_id as "userId", services,
            created_at as "createdAt", updated_at as "updatedAt"
     FROM projects
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows;
}

/**
 * Update service state for a project
 */
export async function updateProjectService(
  projectId: string,
  serviceType: ServiceType,
  state: ServiceState
): Promise<void> {
  // Use jsonb_set to update nested service state
  await db.query(
    `UPDATE projects
     SET services = jsonb_set(
       COALESCE(services, '{}'::jsonb),
       $1,
       $2::jsonb,
       true
     ),
     updated_at = NOW()
     WHERE id = $3`,
    [`{${serviceType}}`, JSON.stringify(state), projectId]
  );
}

/**
 * Update multiple service states atomically
 */
export async function updateProjectServices(
  projectId: string,
  services: Partial<Record<ServiceType, ServiceState>>
): Promise<void> {
  await db.query(
    `UPDATE projects
     SET services = $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(services), projectId]
  );
}

/**
 * Delete project (hard delete)
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM projects WHERE id = $1`,
    [projectId]
  );

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Check if domain is already registered
 */
export async function isDomainTaken(domain: string): Promise<boolean> {
  const result = await db.query(
    `SELECT EXISTS(SELECT 1 FROM projects WHERE domain = $1) as exists`,
    [domain.toLowerCase()]
  );

  return result.rows[0].exists;
}

/**
 * Create a project for Phase 1 (domain purchase only)
 */
export async function createDomainProject(params: {
  id: string;
  name: string;
  domain: string;
  userId: string;
}): Promise<Project> {
  const { id, name, domain, userId } = params;
  const normalizedDomain = domain.toLowerCase();
  const now = new Date().toISOString();

  const serviceStates: Partial<Record<ServiceType, ServiceState>> = {
    domain: { status: 'pending', startedAt: now, updatedAt: now },
  };

  const result = await db.query(
    `INSERT INTO projects (id, name, domain, user_id, services, phase, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING id, name, domain, user_id as "userId", services, phase,
               created_at as "createdAt", updated_at as "updatedAt"`,
    [id, name, normalizedDomain, userId, JSON.stringify(serviceStates), PROJECT_PHASE.DOMAIN]
  );

  return result.rows[0];
}

/**
 * Store contact info and WHOIS privacy preference on a project
 */
export async function updateProjectContactInfo(
  projectId: string,
  contact: RegistrantContact,
  useWhoisPrivacy: boolean
): Promise<void> {
  await db.query(
    `UPDATE projects
     SET contact_info = $1::jsonb,
         use_whois_privacy = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [JSON.stringify(contact), useWhoisPrivacy, projectId]
  );
}

/**
 * Get contact info for a project (used by webhook handler)
 */
export async function getProjectContactInfo(
  projectId: string
): Promise<{ contact: RegistrantContact; useWhoisPrivacy: boolean } | null> {
  const result = await db.query(
    `SELECT contact_info as "contactInfo", use_whois_privacy as "useWhoisPrivacy"
     FROM projects
     WHERE id = $1 AND contact_info IS NOT NULL`,
    [projectId]
  );

  if (!result.rows[0]) return null;

  return {
    contact: result.rows[0].contactInfo,
    useWhoisPrivacy: result.rows[0].useWhoisPrivacy,
  };
}

/**
 * Store Stripe session on a project and set payment status to pending
 */
export async function updateProjectStripeSession(
  projectId: string,
  sessionId: string
): Promise<void> {
  await db.query(
    `UPDATE projects
     SET stripe_session_id = $1,
         stripe_payment_status = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [sessionId, STRIPE_PAYMENT_STATUS.PENDING, projectId]
  );
}

/**
 * Update Stripe payment status (called by webhook handler)
 */
export async function updateProjectPaymentStatus(
  projectId: string,
  status: StripePaymentStatus
): Promise<void> {
  await db.query(
    `UPDATE projects
     SET stripe_payment_status = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [status, projectId]
  );
}

/**
 * Get project by Stripe session ID (used by webhook handler)
 */
export async function getProjectByStripeSession(
  sessionId: string
): Promise<Project | null> {
  const result = await db.query(
    `SELECT id, name, domain, user_id as "userId", services, phase,
            contact_info as "contactInfo", use_whois_privacy as "useWhoisPrivacy",
            stripe_session_id as "stripeSessionId",
            stripe_payment_status as "stripePaymentStatus",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM projects
     WHERE stripe_session_id = $1`,
    [sessionId]
  );

  return result.rows[0] || null;
}

/**
 * Update project phase
 */
export async function updateProjectPhase(
  projectId: string,
  phase: ProjectPhase
): Promise<void> {
  await db.query(
    `UPDATE projects
     SET phase = $1, updated_at = NOW()
     WHERE id = $2`,
    [phase, projectId]
  );
}

/**
 * Add services to an existing project (Phase 2)
 * Uses a transaction to ensure all services are added atomically.
 */
export async function addProjectServices(
  projectId: string,
  services: ServiceType[]
): Promise<void> {
  const now = new Date().toISOString();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    for (const service of services) {
      const state: ServiceState = {
        status: 'pending',
        startedAt: now,
        updatedAt: now,
      };

      await client.query(
        `UPDATE projects
         SET services = jsonb_set(
           COALESCE(services, '{}'::jsonb),
           $1,
           $2::jsonb,
           true
         ),
         updated_at = NOW()
         WHERE id = $3`,
        [`{${service}}`, JSON.stringify(state), projectId]
      );
    }

    // Update phase in the same transaction
    await client.query(
      `UPDATE projects SET phase = $1, updated_at = NOW() WHERE id = $2`,
      [PROJECT_PHASE.SERVICES, projectId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * User database operations
 */

export interface User {
  id: string;
  email: string;
  cloudflareTokenEncrypted: string | null;
  cloudflareAccountId: string | null;
  githubTokenEncrypted: string | null;
  githubUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get user by ID
 */
export async function getUser(userId: string): Promise<User | null> {
  const result = await db.query(
    `SELECT id, email,
            cloudflare_token_encrypted as "cloudflareTokenEncrypted",
            cloudflare_account_id as "cloudflareAccountId",
            github_token_encrypted as "githubTokenEncrypted",
            github_username as "githubUsername",
            created_at as "createdAt",
            updated_at as "updatedAt"
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

/**
 * Upsert user (create or update)
 * Used for storing tokens after OAuth flows
 *
 * IMPORTANT: COALESCE pattern prevents clearing fields
 * - Passing `undefined` or `null` will preserve the existing value
 * - To support token revocation/clearing, pass an explicit empty string '' or update this query
 * - Current behavior: only updates when a non-null value is provided
 */
export async function upsertUser(params: {
  id: string;
  email: string;
  cloudflareTokenEncrypted?: string | null;
  cloudflareAccountId?: string | null;
  githubTokenEncrypted?: string | null;
  githubUsername?: string | null;
}): Promise<User> {
  const {
    id,
    email,
    cloudflareTokenEncrypted,
    cloudflareAccountId,
    githubTokenEncrypted,
    githubUsername,
  } = params;

  const result = await db.query(
    `INSERT INTO users (id, email, cloudflare_token_encrypted, cloudflare_account_id,
                        github_token_encrypted, github_username, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       cloudflare_token_encrypted = COALESCE(EXCLUDED.cloudflare_token_encrypted, users.cloudflare_token_encrypted),
       cloudflare_account_id = COALESCE(EXCLUDED.cloudflare_account_id, users.cloudflare_account_id),
       github_token_encrypted = COALESCE(EXCLUDED.github_token_encrypted, users.github_token_encrypted),
       github_username = COALESCE(EXCLUDED.github_username, users.github_username),
       updated_at = NOW()
     RETURNING id, email,
               cloudflare_token_encrypted as "cloudflareTokenEncrypted",
               cloudflare_account_id as "cloudflareAccountId",
               github_token_encrypted as "githubTokenEncrypted",
               github_username as "githubUsername",
               created_at as "createdAt",
               updated_at as "updatedAt"`,
    [id, email, cloudflareTokenEncrypted, cloudflareAccountId, githubTokenEncrypted, githubUsername]
  );

  return result.rows[0];
}

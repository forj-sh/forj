/**
 * Authorization helpers
 *
 * Stack 7: Authorization checks (fix IDOR vulnerability)
 *
 * Functions to verify resource ownership before granting access.
 *
 * TODO: Error handling - Currently swallows all database errors and returns false.
 * This can hide real server failures (DB connectivity issues, etc.) and incorrectly
 * return 403/404 instead of 500. Consider:
 * - Rethrowing database errors to let routes handle them as 500
 * - Returning discriminated union: { ok: true, owns: boolean } | { ok: false, error }
 * This would allow routes to distinguish between "not authorized" vs "server error"
 */

import { db } from './database.js';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Check if a user owns a project
 *
 * @param projectId - Project UUID
 * @param userId - User UUID
 * @param logger - Fastify logger instance
 * @returns true if user owns the project, false otherwise
 */
export async function verifyProjectOwnership(
  projectId: string,
  userId: string,
  logger: FastifyBaseLogger
): Promise<boolean> {
  try {
    const result = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, userId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  } catch (error) {
    logger.error({ error, projectId, userId }, 'Failed to verify project ownership');
    return false;
  }
}

/**
 * Check if a project exists
 *
 * @param projectId - Project UUID
 * @param logger - Fastify logger instance
 * @returns true if project exists, false otherwise
 */
export async function projectExists(
  projectId: string,
  logger: FastifyBaseLogger
): Promise<boolean> {
  try {
    const result = await db.query(
      'SELECT id FROM projects WHERE id = $1',
      [projectId]
    );

    return result.rowCount !== null && result.rowCount > 0;
  } catch (error) {
    logger.error({ error, projectId }, 'Failed to check project existence');
    return false;
  }
}

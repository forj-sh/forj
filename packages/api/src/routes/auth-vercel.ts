/**
 * Vercel authentication routes
 *
 * Handles storage and verification of Vercel API tokens.
 *
 * ENCRYPTION:
 * - Tokens are encrypted using AES-256-GCM before storage
 * - Encryption key: VERCEL_ENCRYPTION_KEY environment variable
 * - Format: salt:iv:authTag:ciphertext (all base64)
 */

import type { FastifyInstance } from 'fastify';
import { VercelClient, VercelApiError } from '@forj/shared';
import { encrypt, decrypt, isValidEncryptionKey } from '../lib/encryption.js';
import { db } from '../lib/database.js';
import { requireAuth } from '../middleware/auth.js';

interface VercelAuthRequest {
  token: string;
}

/**
 * Vercel authentication routes
 */
export async function vercelAuthRoutes(server: FastifyInstance) {
  /**
   * POST /auth/vercel
   * Store and verify Vercel API token
   */
  server.post<{ Body: VercelAuthRequest }>(
    '/auth/vercel',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const { token } = request.body || {};
      const userId = request.user!.userId;
      const email = request.user!.email;

      if (!token) {
        return reply.status(400).send({
          success: false,
          error: 'Token is required',
        });
      }

      const encryptionKey = process.env.VERCEL_ENCRYPTION_KEY;
      if (!encryptionKey) {
        request.log.error('VERCEL_ENCRYPTION_KEY not configured');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error',
        });
      }

      if (!isValidEncryptionKey(encryptionKey)) {
        request.log.error('VERCEL_ENCRYPTION_KEY is not a valid base64-encoded 32-byte key');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error - invalid encryption key format',
        });
      }

      try {
        // Verify token with Vercel API
        const client = new VercelClient({ token });
        const user = await client.getUser();

        // Get teams to determine scope
        let teamId: string | null = null;
        try {
          const teams = await client.listTeams();
          if (teams.length > 0) {
            // Use default team if set, otherwise first team
            teamId = user.defaultTeamId || teams[0].id;
            if (teams.length > 1) {
              request.log.warn(
                { userId, teamCount: teams.length },
                'User token has access to multiple Vercel teams - using default/first team'
              );
            }
          }
        } catch {
          // Personal account with no teams — teamId stays null
          request.log.info({ userId }, 'No Vercel teams found - using personal account');
        }

        // Encrypt the token
        const encryptedToken = await encrypt(token, encryptionKey);

        // Store in database (upsert user)
        await db.query(
          `
          INSERT INTO users (id, email, vercel_token_encrypted, vercel_team_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id)
          DO UPDATE SET
            vercel_token_encrypted = $3,
            vercel_team_id = $4,
            updated_at = now()
        `,
          [userId, email, encryptedToken, teamId]
        );

        request.log.info(
          { userId, teamId, username: user.username },
          'Vercel token stored successfully'
        );

        return reply.send({
          success: true,
          data: {
            username: user.username,
            teamId,
          },
          message: 'Vercel token verified and stored successfully',
        });
      } catch (error) {
        request.log.error(error, 'Failed to verify Vercel token');

        if (error instanceof VercelApiError) {
          return reply.status(400).send({
            success: false,
            error: error.getUserMessage(),
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Failed to verify Vercel token',
        });
      }
    }
  );

  /**
   * GET /auth/vercel/status
   * Check if user has a valid Vercel token stored
   */
  server.get(
    '/auth/vercel/status',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        const result = await db.query(
          'SELECT vercel_token_encrypted, vercel_team_id FROM users WHERE id = $1',
          [userId]
        );

        if (result.rows.length === 0) {
          return reply.send({
            success: true,
            hasToken: false,
          });
        }

        // hasToken is true only when an encrypted token is actually stored.
        // team_id can legitimately be null for personal accounts.
        const hasToken = !!result.rows[0].vercel_token_encrypted;
        return reply.send({
          success: true,
          hasToken,
          teamId: result.rows[0].vercel_team_id || null,
        });
      } catch (error) {
        request.log.error(error, 'Failed to check Vercel token status');
        return reply.status(500).send({
          success: false,
          error: 'Failed to check token status',
        });
      }
    }
  );

  /**
   * DELETE /auth/vercel
   * Remove stored Vercel token
   */
  server.delete(
    '/auth/vercel',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        await db.query(
          `
          UPDATE users
          SET vercel_token_encrypted = NULL,
              vercel_team_id = NULL,
              updated_at = now()
          WHERE id = $1
        `,
          [userId]
        );

        request.log.info({ userId }, 'Vercel token removed');

        return reply.send({
          success: true,
          message: 'Vercel token removed successfully',
        });
      } catch (error) {
        request.log.error(error, 'Failed to remove Vercel token');
        return reply.status(500).send({
          success: false,
          error: 'Failed to remove token',
        });
      }
    }
  );
}

/**
 * Helper function to get decrypted Vercel token for a user
 */
export async function getVercelToken(userId: string): Promise<string | null> {
  const encryptionKey = process.env.VERCEL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('VERCEL_ENCRYPTION_KEY not configured');
  }

  const result = await db.query(
    'SELECT vercel_token_encrypted FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].vercel_token_encrypted) {
    return null;
  }

  const encryptedToken = result.rows[0].vercel_token_encrypted;
  return await decrypt(encryptedToken, encryptionKey);
}

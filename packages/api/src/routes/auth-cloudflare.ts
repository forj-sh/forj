/**
 * Cloudflare authentication routes
 *
 * Handles storage and verification of Cloudflare API tokens.
 *
 * TOKEN ROTATION WORKFLOW:
 * 1. User creates new API token in Cloudflare dashboard with required permissions
 * 2. User calls POST /auth/cloudflare with new token
 * 3. Server verifies token, encrypts it, and stores in database (replaces old token)
 * 4. User should manually revoke old token in Cloudflare dashboard
 *
 * To completely remove credentials:
 * - Call DELETE /auth/cloudflare to clear stored token
 * - Manually revoke token in Cloudflare dashboard
 *
 * ENCRYPTION:
 * - Tokens are encrypted using AES-256-GCM before storage
 * - Encryption key: CLOUDFLARE_ENCRYPTION_KEY environment variable (shared credential encryption key)
 * - Format: salt:iv:authTag:ciphertext (all base64)
 * - TODO: Consider using separate encryption keys per service for better security isolation
 */

import type { FastifyInstance } from 'fastify';
import { CloudflareClient, CloudflareApiError } from '@forj/shared';
import { encrypt, decrypt, isValidEncryptionKey } from '../lib/encryption.js';
import { db } from '../lib/database.js';
import { requireAuth } from '../middleware/auth.js';

interface CloudflareAuthRequest {
  token: string;
}

interface CloudflareAuthResponse {
  success: boolean;
  accountId?: string;
  message?: string;
}

interface CloudflareStatusResponse {
  hasToken: boolean;
  accountId?: string;
}

/**
 * Cloudflare authentication routes
 */
export async function cloudflareAuthRoutes(server: FastifyInstance) {
  /**
   * POST /auth/cloudflare
   * Store and verify Cloudflare API token
   */
  server.post<{ Body: CloudflareAuthRequest }>(
    '/auth/cloudflare',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Defensive body parsing
      const { token } = request.body || {};

      // Get userId from authenticated user
      const userId = request.user!.userId;
      const email = request.user!.email;

      // Validate request
      if (!token) {
        return reply.status(400).send({
          success: false,
          error: 'Token is required',
        });
      }

      // Get encryption key from environment and validate format
      const encryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
      if (!encryptionKey) {
        request.log.error('CLOUDFLARE_ENCRYPTION_KEY not configured');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error',
        });
      }

      if (!isValidEncryptionKey(encryptionKey)) {
        request.log.error('CLOUDFLARE_ENCRYPTION_KEY is not a valid base64-encoded 32-byte key');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error - invalid encryption key format',
        });
      }

      try {
        // Verify token with Cloudflare API
        const client = new CloudflareClient({ apiToken: token });
        const verification = await client.verifyToken();

        if (verification.status !== 'active') {
          return reply.status(400).send({
            success: false,
            error: 'Token is not active',
          });
        }

        // Get account info
        const accounts = await client.listAccounts();
        if (accounts.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'No Cloudflare accounts found for this token',
          });
        }

        // LIMITATION: If the token has access to multiple accounts, we use the first one.
        // Future enhancement: Allow user to select which account to use.
        const accountId = accounts[0].id;
        if (accounts.length > 1) {
          request.log.warn(
            { userId, accountCount: accounts.length },
            'User token has access to multiple Cloudflare accounts - using first account'
          );
        }

        // Encrypt the token
        const encryptedToken = await encrypt(token, encryptionKey);

        // Store in database (upsert user)
        await db.query(
          `
          INSERT INTO users (id, email, cloudflare_token_encrypted, cloudflare_account_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id)
          DO UPDATE SET
            cloudflare_token_encrypted = $3,
            cloudflare_account_id = $4,
            updated_at = now()
        `,
          [userId, email, encryptedToken, accountId]
        );

        request.log.info(
          {
            userId,
            accountId,
          },
          'Cloudflare token stored successfully'
        );

        // Use consistent response envelope with data field
        return reply.send({
          success: true,
          data: {
            accountId,
          },
          message: 'Cloudflare token verified and stored successfully',
        });
      } catch (error) {
        request.log.error(error, 'Failed to verify Cloudflare token');

        if (error instanceof CloudflareApiError) {
          return reply.status(400).send({
            success: false,
            error: error.getUserMessage(),
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Failed to verify Cloudflare token',
        });
      }
    }
  );

  /**
   * GET /auth/cloudflare/status
   * Check if user has a valid Cloudflare token stored
   */
  server.get(
    '/auth/cloudflare/status',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Get userId from authenticated user (no IDOR vulnerability)
      const userId = request.user!.userId;

      try {
        const result = await db.query(
          'SELECT cloudflare_account_id FROM users WHERE id = $1',
          [userId]
        );

        if (result.rows.length === 0 || !result.rows[0].cloudflare_account_id) {
          return reply.send({
            success: true,
            hasToken: false,
          });
        }

        return reply.send({
          success: true,
          hasToken: true,
          accountId: result.rows[0].cloudflare_account_id,
        });
      } catch (error) {
        request.log.error(error, 'Failed to check Cloudflare token status');
        return reply.status(500).send({
          success: false,
          error: 'Failed to check token status',
        });
      }
    }
  );

  /**
   * DELETE /auth/cloudflare
   * Remove stored Cloudflare token
   */
  server.delete(
    '/auth/cloudflare',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Get userId from authenticated user (no IDOR vulnerability)
      const userId = request.user!.userId;

      try {
        await db.query(
          `
          UPDATE users
          SET cloudflare_token_encrypted = NULL,
              cloudflare_account_id = NULL,
              updated_at = now()
          WHERE id = $1
        `,
          [userId]
        );

        request.log.info({ userId }, 'Cloudflare token removed');

        return reply.send({
          success: true,
          message: 'Cloudflare token removed successfully',
        });
      } catch (error) {
        request.log.error(error, 'Failed to remove Cloudflare token');
        return reply.status(500).send({
          success: false,
          error: 'Failed to remove token',
        });
      }
    }
  );
}

/**
 * Helper function to get decrypted Cloudflare token for a user
 * (for use in other parts of the API)
 */
export async function getCloudflareToken(userId: string): Promise<string | null> {
  const encryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('CLOUDFLARE_ENCRYPTION_KEY not configured');
  }

  const result = await db.query(
    'SELECT cloudflare_token_encrypted FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].cloudflare_token_encrypted) {
    return null;
  }

  const encryptedToken = result.rows[0].cloudflare_token_encrypted;
  return await decrypt(encryptedToken, encryptionKey);
}

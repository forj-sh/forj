/**
 * GitHub authentication routes
 *
 * Implements OAuth Device Flow (RFC 8628)
 *
 * TOKEN ROTATION WORKFLOW:
 * 1. User calls POST /auth/github/device to initiate new device flow
 * 2. User authorizes at github.com/login/device with provided user code
 * 3. Client polls POST /auth/github/poll with device code
 * 4. Server gets new access token and stores it (replaces old token)
 * 5. Old token is implicitly superseded (GitHub doesn't support explicit revocation)
 *
 * To completely remove credentials:
 * - Call DELETE /auth/github to clear stored token
 * - User can revoke access at github.com/settings/applications
 *
 * ENCRYPTION: Stack 7 - Service-specific encryption keys
 * - Tokens are encrypted using AES-256-GCM before storage
 * - Encryption key: GITHUB_ENCRYPTION_KEY environment variable (GitHub-specific)
 * - Format: salt:iv:authTag:ciphertext (all base64)
 * - Security isolation: Separate key from Cloudflare credentials
 *
 * SECURITY:
 * - Server enforces scopes (repo read:org) - client cannot escalate privileges
 * - User ID extracted from JWT - no IDOR vulnerability
 * - Tokens never logged or exposed in responses
 */

import type { FastifyInstance } from 'fastify';
import { GitHubDeviceFlow } from '../lib/github-oauth.js';
import { encrypt, decrypt, isValidEncryptionKey } from '../lib/encryption.js';
import { db } from '../lib/database.js';
import { requireAuth } from '../middleware/auth.js';

interface GitHubDeviceInitRequest {
  scope?: string;
}

interface GitHubDeviceInitResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface GitHubPollRequest {
  deviceCode: string;
}

interface GitHubPollResponse {
  status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'authorized';
  username?: string;
  message?: string;
}

interface GitHubStatusResponse {
  hasToken: boolean;
  username?: string;
}

/**
 * GitHub authentication routes
 */
export async function githubAuthRoutes(server: FastifyInstance) {
  // Get GitHub OAuth credentials from environment
  const getGitHubClient = () => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth not configured');
    }

    return new GitHubDeviceFlow(clientId, clientSecret);
  };

  /**
   * POST /auth/github/device
   * Initiate GitHub OAuth Device Flow
   */
  server.post<{ Body: GitHubDeviceInitRequest }>(
    '/auth/github/device',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Get userId from authenticated user (no IDOR)
      const userId = request.user!.userId;

      // Enforce server-side scope to prevent privilege escalation
      const scope = 'repo read:org';

      try {
        const client = getGitHubClient();
        const deviceCode = await client.initiateDeviceFlow(scope);

        request.log.info(
          {
            userId,
          },
          'GitHub device flow initiated'
        );

        const response: GitHubDeviceInitResponse = {
          deviceCode: deviceCode.device_code,
          userCode: deviceCode.user_code,
          verificationUri: deviceCode.verification_uri,
          expiresIn: deviceCode.expires_in,
          interval: deviceCode.interval,
        };

        return reply.send({
          success: true,
          data: response,
        });
      } catch (error) {
        request.log.error(error, 'Failed to initiate GitHub device flow');

        if (error instanceof Error && error.message.includes('not configured')) {
          return reply.status(500).send({
            success: false,
            error: 'GitHub OAuth not configured on server',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Failed to initiate GitHub authentication',
        });
      }
    }
  );

  /**
   * POST /auth/github/poll
   * Poll for GitHub OAuth token
   */
  server.post<{ Body: GitHubPollRequest }>(
    '/auth/github/poll',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Get userId from authenticated user (no IDOR)
      const userId = request.user!.userId;
      const email = request.user!.email;
      const { deviceCode } = request.body || {};

      if (!deviceCode) {
        return reply.status(400).send({
          success: false,
          error: 'deviceCode is required',
        });
      }

      // Get encryption key and validate format
      const encryptionKey = process.env.GITHUB_ENCRYPTION_KEY;
      if (!encryptionKey) {
        request.log.error('GITHUB_ENCRYPTION_KEY not configured');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error',
        });
      }

      if (!isValidEncryptionKey(encryptionKey)) {
        request.log.error('GITHUB_ENCRYPTION_KEY is not a valid base64-encoded 32-byte key');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error - invalid encryption key format',
        });
      }

      try {
        const client = getGitHubClient();
        const result = await client.pollForToken(deviceCode);

        // Handle non-authorized statuses with a map for cleaner code
        if (result.status !== 'authorized') {
          const statusMessages: Record<
            'pending' | 'slow_down' | 'expired' | 'denied',
            string
          > = {
            pending: 'Waiting for user authorization',
            slow_down: 'Polling too frequently - please slow down',
            expired: 'Device code has expired - please start over',
            denied: 'User denied authorization',
          };
          const response: GitHubPollResponse = {
            status: result.status,
            message: statusMessages[result.status],
          };
          return reply.send({ success: true, data: response });
        }

        // Authorization successful - get user info and store token
        const userInfo = await client.getUserInfo(result.accessToken);
        const encryptedToken = await encrypt(result.accessToken, encryptionKey);

        // Store in database (upsert user)
        await db.query(
          `
          INSERT INTO users (id, email, github_token_encrypted, github_username)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id)
          DO UPDATE SET
            github_token_encrypted = $3,
            github_username = $4,
            updated_at = now()
        `,
          [
            userId,
            userInfo.email || `${userInfo.login}@users.noreply.github.com`,
            encryptedToken,
            userInfo.login,
          ]
        );

        request.log.info(
          {
            userId,
            githubUsername: userInfo.login,
          },
          'GitHub token stored successfully'
        );

        const response: GitHubPollResponse = {
          status: 'authorized',
          username: userInfo.login,
          message: 'GitHub authorization successful',
        };

        return reply.send({ success: true, data: response });
      } catch (error) {
        request.log.error(error, 'Failed to poll for GitHub token');

        if (error instanceof Error && error.message.includes('not configured')) {
          return reply.status(500).send({
            success: false,
            error: 'GitHub OAuth not configured on server',
          });
        }

        return reply.status(500).send({
          success: false,
          error: 'Failed to poll for GitHub token',
        });
      }
    }
  );

  /**
   * GET /auth/github/status
   * Check if user has a valid GitHub token stored
   */
  server.get(
    '/auth/github/status',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Get userId from authenticated user (no IDOR)
      const userId = request.user!.userId;

      try {
        const result = await db.query(
          'SELECT github_token_encrypted, github_username FROM users WHERE id = $1',
          [userId]
        );

        if (
          result.rows.length === 0 ||
          !result.rows[0].github_token_encrypted ||
          !result.rows[0].github_username
        ) {
          const response: GitHubStatusResponse = {
            hasToken: false,
          };
          return reply.send({ success: true, data: response });
        }

        const response: GitHubStatusResponse = {
          hasToken: true,
          username: result.rows[0].github_username,
        };

        return reply.send({ success: true, data: response });
      } catch (error) {
        request.log.error(error, 'Failed to check GitHub token status');
        return reply.status(500).send({
          success: false,
          error: 'Failed to check token status',
        });
      }
    }
  );

  /**
   * DELETE /auth/github
   * Remove stored GitHub token
   */
  server.delete(
    '/auth/github',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      // Get userId from authenticated user (no IDOR)
      const userId = request.user!.userId;

      try {
        await db.query(
          `
          UPDATE users
          SET github_token_encrypted = NULL,
              github_username = NULL,
              updated_at = now()
          WHERE id = $1
        `,
          [userId]
        );

        request.log.info({ userId }, 'GitHub token removed');

        return reply.send({
          success: true,
          message: 'GitHub token removed successfully',
        });
      } catch (error) {
        request.log.error(error, 'Failed to remove GitHub token');
        return reply.status(500).send({
          success: false,
          error: 'Failed to remove token',
        });
      }
    }
  );
}

/**
 * Helper function to get decrypted GitHub token for a user
 * (for use in other parts of the API)
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const encryptionKey = process.env.GITHUB_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('GITHUB_ENCRYPTION_KEY not configured');
  }

  const result = await db.query(
    'SELECT github_token_encrypted FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].github_token_encrypted) {
    return null;
  }

  const encryptedToken = result.rows[0].github_token_encrypted;
  return decrypt(encryptedToken, encryptionKey);
}

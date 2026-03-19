/**
 * GitHub authentication routes
 *
 * **V1 PRIMARY AUTHENTICATION METHOD**
 *
 * Implements OAuth Device Flow (RFC 8628) as the ONLY authentication method for V1.
 * There is no separate signup flow - GitHub authorization creates the user account.
 *
 * V1 DESIGN DECISION:
 * - No email/password auth
 * - No separate "create account" flow
 * - GitHub identity IS the Forj identity
 * - User ID format: github:<numeric_id> (e.g., github:583231 - immutable GitHub user ID)
 * - Username stored separately (can change without orphaning account)
 * - This means users MUST have a GitHub account to use Forj V1
 *
 * NEW USER ONBOARDING FLOW (V1 - `forj init` or `forj login`):
 * 1. Unauthenticated CLI calls POST /auth/github/device (public, no auth required)
 * 2. API returns device_code, user_code, and verification_uri
 * 3. CLI opens browser to github.com/login/device
 * 4. User enters user_code and authorizes Forj app (scopes: repo read:org)
 * 5. CLI polls POST /auth/github/poll with device_code (public, no auth required)
 * 6. API exchanges device_code for GitHub access token via GitHub's OAuth API
 * 7. API fetches user info from GitHub (username, email)
 * 8. API creates user record in database (first-time users) OR updates existing record
 * 9. API stores encrypted GitHub token for GitHub API operations (repo creation, etc.)
 * 10. API generates JWT token with userId and email
 * 11. API returns { status: 'authorized', token: '<jwt>', user: { id, email }, username }
 * 12. CLI stores JWT in ~/.forj/config.json
 * 13. CLI uses JWT for all subsequent authenticated API calls
 *
 * CLI INTEGRATION NOTES:
 * - CLI should call FORJ API endpoints (/auth/github/device, /auth/github/poll)
 * - CLI should NOT call GitHub OAuth endpoints directly
 * - CLI stores the JWT token returned in the poll response
 * - JWT token is used for all authenticated API requests (Authorization: Bearer <token>)
 * - GitHub access token is stored server-side (encrypted) and never sent to CLI
 *
 * TOKEN ROTATION WORKFLOW:
 * - Same flow as initial auth (endpoints are idempotent)
 * - Replaces stored GitHub token with new one
 * - Returns a new JWT token
 *
 * To completely remove credentials:
 * - Call DELETE /auth/github to clear stored GitHub token (requires JWT auth)
 * - User can revoke app access at github.com/settings/applications
 * - CLI can delete ~/.forj/config.json to clear JWT
 *
 * ENCRYPTION:
 * - GitHub access tokens encrypted using AES-256-GCM before storage
 * - Encryption key: GITHUB_ENCRYPTION_KEY environment variable
 * - Format: salt:iv:authTag:ciphertext (all base64)
 * - Separate key from Cloudflare credentials (security isolation)
 *
 * SECURITY:
 * - /auth/github/device and /auth/github/poll are PUBLIC endpoints (no JWT required)
 * - IP rate limiting prevents abuse (rate-limit-config.ts)
 * - GitHub OAuth flow provides authentication (device code is one-time nonce)
 * - Server enforces scopes (repo read:org) - client cannot escalate privileges
 * - User ID derived from GitHub username (prevents impersonation)
 * - JWT tokens issued only after successful GitHub authorization
 * - GitHub access tokens never exposed to CLI (stored encrypted server-side)
 * - All secrets sanitized in error logs
 */

import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { GitHubDeviceFlow } from '../lib/github-oauth.js';
import { encrypt, decrypt, isValidEncryptionKey } from '../lib/encryption.js';
import { db, upsertUser } from '../lib/database.js';
import { requireAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';

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
  token?: string; // JWT token returned on successful authorization
  user?: {
    id: string;
    email: string;
  };
}

interface GitHubStatusResponse {
  hasToken: boolean;
  username?: string;
}

// JWT token expiration (1 year for primary authentication tokens)
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

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
   *
   * PUBLIC ENDPOINT - No authentication required
   * This is the entry point for new user onboarding
   */
  server.post<{ Body: GitHubDeviceInitRequest }>(
    '/auth/github/device',
    {
      preHandler: [
        ipRateLimit('auth-github-device', {
          maxRequests: 20, // Allow 20 device flow initiations per hour per IP
          windowMs: 60 * 60 * 1000, // 1 hour window
        }),
      ],
    },
    async (request, reply) => {
      // Enforce server-side scope to prevent privilege escalation
      const scope = 'repo read:org';

      try {
        const client = getGitHubClient();
        const deviceCode = await client.initiateDeviceFlow(scope);

        request.log.info('GitHub device flow initiated (public endpoint)');

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
   *
   * PUBLIC ENDPOINT - No authentication required
   * Creates new user account on first successful authorization
   * Returns JWT token for authenticated API access
   */
  server.post<{ Body: GitHubPollRequest }>(
    '/auth/github/poll',
    {
      preHandler: [
        ipRateLimit('auth-github-poll', {
          maxRequests: 200, // Allow frequent polling (5s interval for ~15 minutes = 180 requests)
          windowMs: 15 * 60 * 1000, // 15 minute window (typical device code expiry)
        }),
      ],
    },
    async (request, reply) => {
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

      // Get JWT secret for token generation
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        request.log.error('JWT_SECRET not configured');
        return reply.status(500).send({
          success: false,
          error: 'Server configuration error',
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

        // Generate user ID from GitHub numeric ID (immutable - survives username changes)
        // Using numeric ID prevents orphaned accounts when users rename their GitHub username
        const userId = `github:${userInfo.id}`;
        const email = userInfo.email || `${userInfo.login}@users.noreply.github.com`;

        // Store in database using upsertUser helper (handles COALESCE logic for token updates)
        await upsertUser({
          id: userId,
          email,
          githubTokenEncrypted: encryptedToken,
          githubUsername: userInfo.login,
        });

        // Generate JWT token for authenticated API access (1 year expiration)
        // CLI will store this token and use it for all subsequent authenticated requests
        const now = Math.floor(Date.now() / 1000);
        const secret = new TextEncoder().encode(jwtSecret);

        const jwtToken = await new SignJWT({
          userId,
          email,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(now)
          .setExpirationTime(now + ONE_YEAR_IN_SECONDS)
          .sign(secret);

        request.log.info(
          {
            userId,
            githubUsername: userInfo.login,
          },
          'GitHub authorization successful - user authenticated'
        );

        // Return JWT token + user info to CLI
        // CLI stores token in ~/.forj/config.json and uses for all authenticated API calls
        const response: GitHubPollResponse = {
          status: 'authorized',
          username: userInfo.login, // Display name (can change)
          message: 'GitHub authorization successful',
          token: jwtToken, // CLI stores this JWT
          user: {
            id: userId, // github:<numeric_id> - immutable identifier
            email,
          },
        };

        return reply.send({ success: true, data: response });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        request.log.error({ err: error, errorMessage }, 'Failed to poll for GitHub token');

        if (errorMessage.includes('not configured')) {
          return reply.status(500).send({
            success: false,
            error: 'GitHub OAuth not configured on server',
          });
        }

        return reply.status(500).send({
          success: false,
          error: `Failed to poll for GitHub token: ${errorMessage}`,
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
  if (!encryptionKey || !isValidEncryptionKey(encryptionKey)) {
    throw new Error('GITHUB_ENCRYPTION_KEY not configured or is invalid');
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

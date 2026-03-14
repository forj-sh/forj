import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { logger } from './logger.js';

/**
 * Valid API key scopes
 */
export const API_KEY_SCOPES = {
  AGENT_PROVISION: 'agent:provision',
  AGENT_READ: 'agent:read',
} as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES];

/**
 * API key prefixes
 */
export const API_KEY_PREFIXES = {
  LIVE: 'forj_live_',
  TEST: 'forj_test_',
} as const;

export type ApiKeyPrefix = (typeof API_KEY_PREFIXES)[keyof typeof API_KEY_PREFIXES];

/**
 * Length of key hint for efficient lookups
 */
export const KEY_HINT_LENGTH = 8;

/**
 * API key record from database
 */
export interface ApiKeyRecord {
  id: string;
  user_id: string;
  key_hash: string;
  key_hint: string;
  scopes: string[];
  name: string | null;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Options for creating an API key
 */
export interface CreateApiKeyOptions {
  userId: string;
  scopes: ApiKeyScope[];
  name?: string;
  expiresAt?: Date;
  environment?: 'live' | 'test';
}

/**
 * Result of creating an API key
 */
export interface CreateApiKeyResult {
  id: string;
  key: string; // Raw key (only returned once)
  userId: string;
  scopes: ApiKeyScope[];
  name: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

/**
 * Result of verifying an API key
 */
export interface VerifyApiKeyResult {
  valid: boolean;
  keyRecord?: ApiKeyRecord;
  error?: string;
}

/**
 * Result of rotating an API key
 */
export interface RotateApiKeyResult {
  id: string;
  key: string; // Raw key (only returned once)
  userId: string;
  scopes: ApiKeyScope[];
  name: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  oldKeyId: string; // ID of the revoked key
}

/**
 * Custom error for API key not found
 */
export class ApiKeyNotFoundError extends Error {
  constructor(message = 'API key not found or access denied') {
    super(message);
    this.name = 'ApiKeyNotFoundError';
  }
}

/**
 * Custom error for revoked API key
 */
export class ApiKeyRevokedError extends Error {
  constructor(message = 'Cannot rotate a revoked API key') {
    super(message);
    this.name = 'ApiKeyRevokedError';
  }
}

/**
 * API Key Service
 *
 * Handles generation, storage, and verification of API keys for agent authentication.
 */
export class ApiKeyService {
  private db: Pool;
  private bcryptRounds: number;

  constructor(db: Pool, bcryptRounds = 10) {
    this.db = db;
    this.bcryptRounds = bcryptRounds;
  }

  /**
   * Validate scopes against allowed list
   */
  validateScopes(scopes: string[]): ApiKeyScope[] {
    const allowedScopes = Object.values(API_KEY_SCOPES);
    const invalidScopes = scopes.filter((scope) => !allowedScopes.includes(scope as ApiKeyScope));

    if (invalidScopes.length > 0) {
      throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}`);
    }

    if (scopes.length === 0) {
      throw new Error('At least one scope is required');
    }

    return scopes as ApiKeyScope[];
  }

  /**
   * Generate a random API key with the specified prefix
   */
  generateKey(prefix: ApiKeyPrefix = API_KEY_PREFIXES.LIVE): string {
    // Generate 32 random bytes and encode as base64url
    const randomBytes = crypto.randomBytes(32);
    const encoded = randomBytes.toString('base64url').replace(/=/g, ''); // Remove padding

    return `${prefix}${encoded}`;
  }

  /**
   * Hash an API key using bcrypt
   */
  async hashKey(key: string): Promise<string> {
    return bcrypt.hash(key, this.bcryptRounds);
  }

  /**
   * Verify an API key against a hash
   */
  async verifyKeyHash(key: string, hash: string): Promise<boolean> {
    return bcrypt.compare(key, hash);
  }

  /**
   * Create a new API key
   */
  async createApiKey(options: CreateApiKeyOptions): Promise<CreateApiKeyResult> {
    const { userId, scopes, name, expiresAt, environment = 'live' } = options;

    // Validate scopes
    const validatedScopes = this.validateScopes(scopes);

    // Generate key
    const prefix = environment === 'live' ? API_KEY_PREFIXES.LIVE : API_KEY_PREFIXES.TEST;
    const key = this.generateKey(prefix);

    // Extract key hint (first 8 chars after prefix)
    const keyHint = key.substring(prefix.length, prefix.length + KEY_HINT_LENGTH);

    // Hash key
    const keyHash = await this.hashKey(key);

    // Insert into database
    const result = await this.db.query<ApiKeyRecord>(
      `
      INSERT INTO api_keys (user_id, key_hash, key_hint, scopes, name, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, scopes, name, created_at, expires_at
      `,
      [userId, keyHash, keyHint, validatedScopes, name || null, expiresAt || null]
    );

    const record = result.rows[0];

    logger.info({
      msg: 'API key created',
      userId,
      keyId: record.id,
      scopes: validatedScopes,
      environment,
    });

    return {
      id: record.id,
      key, // Return raw key only once
      userId: record.user_id,
      scopes: record.scopes as ApiKeyScope[],
      name: record.name,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
    };
  }

  /**
   * Verify an API key and return the associated record
   */
  async verifyApiKey(key: string): Promise<VerifyApiKeyResult> {
    // Check if key has valid prefix
    const prefix = Object.values(API_KEY_PREFIXES).find((p) => key.startsWith(p));
    if (!prefix) {
      return { valid: false, error: 'Invalid key format' };
    }

    // Extract key hint for efficient lookup
    const keyHint = key.substring(prefix.length, prefix.length + KEY_HINT_LENGTH);

    // Get active keys with the same hint (efficient indexed lookup)
    const result = await this.db.query<ApiKeyRecord>(
      `
      SELECT id, user_id, key_hash, key_hint, scopes, name, created_at, expires_at, last_used_at, revoked_at
      FROM api_keys
      WHERE key_hint = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      `,
      [keyHint]
    );

    // Check each key hash (for the rare case of a hint collision)
    for (const record of result.rows) {
      const isValid = await this.verifyKeyHash(key, record.key_hash);

      if (isValid) {
        // Update last_used_at without blocking the response (fire-and-forget)
        this.db
          .query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [record.id])
          .catch((err) => {
            logger.error({ err, keyId: record.id }, 'Failed to update last_used_at for API key');
          });

        logger.info({
          msg: 'API key verified',
          keyId: record.id,
          userId: record.user_id,
        });

        return {
          valid: true,
          keyRecord: record,
        };
      }
    }

    return { valid: false, error: 'Invalid or revoked API key' };
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(keyId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `
      UPDATE api_keys
      SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id
      `,
      [keyId, userId]
    );

    if (result.rowCount === 0) {
      return false;
    }

    logger.info({
      msg: 'API key revoked',
      keyId,
      userId,
    });

    return true;
  }

  /**
   * List all API keys for a user (excluding revoked keys by default)
   */
  async listApiKeys(userId: string, includeRevoked = false): Promise<ApiKeyRecord[]> {
    const query = includeRevoked
      ? `SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`
      : `SELECT * FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`;

    const result = await this.db.query<ApiKeyRecord>(query, [userId]);

    return result.rows;
  }

  /**
   * Get a single API key by ID (must belong to user)
   */
  async getApiKey(keyId: string, userId: string): Promise<ApiKeyRecord | null> {
    const result = await this.db.query<ApiKeyRecord>(
      `SELECT * FROM api_keys WHERE id = $1 AND user_id = $2`,
      [keyId, userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Rotate an API key (revoke old, create new with same scopes)
   *
   * SECURITY: Stack 5 - Atomic operation using database transactions
   * - All operations wrapped in BEGIN...COMMIT transaction
   * - If any step fails, transaction rolls back (old key remains valid)
   * - User never left without a valid API key
   *
   * @param keyId - ID of the key to rotate
   * @param userId - User ID (for authorization)
   * @returns New API key with same scopes and name
   * @throws ApiKeyNotFoundError if key doesn't exist or doesn't belong to user
   * @throws ApiKeyRevokedError if key is already revoked
   */
  async rotateApiKey(keyId: string, userId: string): Promise<RotateApiKeyResult> {
    // Get a connection from the pool for transaction
    const client = await this.db.connect();

    try {
      // Start transaction
      await client.query('BEGIN');

      // Get existing key with row-level lock (prevent concurrent modifications)
      const result = await client.query<ApiKeyRecord>(
        `SELECT id, user_id, key_hash, key_hint, scopes, name, created_at, expires_at, last_used_at, revoked_at
         FROM api_keys
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [keyId, userId]
      );

      const existingKey = result.rows[0];

      if (!existingKey) {
        throw new ApiKeyNotFoundError();
      }

      // Cannot rotate revoked keys
      if (existingKey.revoked_at) {
        throw new ApiKeyRevokedError();
      }

      // Infer environment from key_hint
      const environment: 'live' | 'test' = existingKey.key_hint.startsWith('forj_liv')
        ? 'live'
        : 'test';

      // Revoke old key (within transaction)
      await client.query(
        `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`,
        [keyId]
      );

      // Generate new API key
      const newKey = await this.generateApiKey(environment);
      const keyHash = await this.hashApiKey(newKey);
      const keyHint = newKey.substring(0, KEY_HINT_LENGTH);

      // Insert new key (within transaction)
      const insertResult = await client.query<ApiKeyRecord>(
        `INSERT INTO api_keys (user_id, key_hash, key_hint, scopes, name, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, key_hash, key_hint, scopes, name, created_at, expires_at, last_used_at, revoked_at`,
        [
          userId,
          keyHash,
          keyHint,
          JSON.stringify(existingKey.scopes),
          existingKey.name,
          existingKey.expires_at,
        ]
      );

      const newRecord = insertResult.rows[0];

      // Commit transaction - both operations succeed atomically
      await client.query('COMMIT');

      logger.info({
        msg: 'API key rotated successfully',
        oldKeyId: keyId,
        newKeyId: newRecord.id,
        userId,
        scopes: newRecord.scopes,
        environment,
      });

      return {
        keyId: newRecord.id,
        key: newKey,
        scopes: newRecord.scopes as ApiKeyScope[],
        name: newRecord.name || undefined,
        expiresAt: newRecord.expires_at || undefined,
        createdAt: newRecord.created_at,
        oldKeyId: keyId,
      };
    } catch (error) {
      // Rollback transaction on any error - old key remains valid
      await client.query('ROLLBACK');

      logger.error({
        error,
        keyId,
        userId,
        msg: 'API key rotation failed - transaction rolled back, old key still valid',
      });

      // Re-throw the error for the caller to handle
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  }
}

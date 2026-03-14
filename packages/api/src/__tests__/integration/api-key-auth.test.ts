/**
 * Integration tests for API key authentication and authorization
 *
 * Tests the full API key authentication flow:
 * 1. Create API key via JWT
 * 2. Use API key to authenticate
 * 3. Scope enforcement
 * 4. Key rotation
 * 5. Security boundaries
 */

import 'dotenv/config'; // Load environment variables
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { API_KEY_SCOPES } from '../../lib/api-key-service.js';
import { db } from '../../lib/database.js';
import { getRedis } from '../../lib/redis.js';

describe('API Key Authentication & Authorization', () => {
  let server: FastifyInstance;
  let jwtToken: string;
  const testUserId = 'test-user-api-key-auth';
  const testEmail = 'auth-test@example.com';
  const jwtSecret = 'test-secret-for-api-key-auth';

  beforeAll(async () => {
    // Disable rate limiting for tests to avoid 429 errors
    process.env.RATE_LIMITING_ENABLED = 'false';
    process.env.JWT_SECRET = jwtSecret;
    server = await createServer();

    // Insert test user into database (required for foreign key constraint)
    await db.query(
      'INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [testUserId, testEmail]
    );

    // Generate JWT token for creating API keys
    const secret = new TextEncoder().encode(jwtSecret);
    jwtToken = await new SignJWT({ userId: testUserId, email: testEmail })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
  }, 30000); // 30 second timeout for server startup

  afterAll(async () => {
    try {
      // Delete API keys first (foreign key constraint)
      await db.query('DELETE FROM api_keys WHERE user_id = $1', [testUserId]);
      // Delete test user
      await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
    } catch (error) {
      console.warn('Cleanup error (non-critical):', error);
    }
    await server.close();
  }, 30000); // 30 second timeout for cleanup

  beforeEach(async () => {
    try {
      // Clear API keys
      await db.query('DELETE FROM api_keys WHERE user_id = $1', [testUserId]);

      // Clear Redis rate limiting data to avoid 429 errors
      const redis = getRedis();
      if (redis) {
        await redis.flushdb();
      }
    } catch (error) {
      console.warn('BeforeEach cleanup error (non-critical):', error);
    }
  }, 30000); // 30 second timeout for each cleanup

  describe('API Key Authentication Flow', () => {
    it('should authenticate with API key and access protected routes', async () => {
      // Step 1: Create API key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          name: 'Test Auth Key',
          scopes: [API_KEY_SCOPES.AGENT_READ],
          environment: 'test',
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const { key } = JSON.parse(createResponse.body).data;
      expect(key).toMatch(/^forj_test_/);

      // Step 2: Use API key to authenticate
      const listResponse = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${key}`,
        },
      });

      expect(listResponse.statusCode).toBe(200);
      const body = JSON.parse(listResponse.body);
      expect(body.success).toBe(true);
      expect(body.data.keys).toHaveLength(1);
      expect(body.data.keys[0].name).toBe('Test Auth Key');
    });

    it('should reject invalid API key format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: 'Bearer invalid-key-format',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_API_KEY');
    });

    it('should reject non-existent API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: 'Bearer forj_live_nonexistent1234567890abcdefghijklmnop',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_API_KEY');
    });

    it('should reject revoked API key', async () => {
      // Create and revoke a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { id, key } = JSON.parse(createResponse.body).data;

      // Revoke the key
      await server.inject({
        method: 'DELETE',
        url: `/api-keys/${id}`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      // Try to use revoked key
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${key}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('revoked');
    });

    it('should reject expired API key', async () => {
      // Create key with past expiration date
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

      // First attempt should fail at creation
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
          expiresAt: pastDate.toISOString(),
        },
      });

      expect(createResponse.statusCode).toBe(400);
      const body = JSON.parse(createResponse.body);
      expect(body.error).toContain('future');
    });
  });

  describe('Scope-Based Authorization', () => {
    it('should allow access with correct scope', async () => {
      // Create key with agent:provision scope
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      const { key } = JSON.parse(createResponse.body).data;

      // Note: We can't test /provision route directly without full infrastructure,
      // but we can verify the API key was created with correct scopes
      const listResponse = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${key}`,
        },
      });

      expect(listResponse.statusCode).toBe(200);
      const body = JSON.parse(listResponse.body);
      expect(body.data.keys[0].scopes).toContain(API_KEY_SCOPES.AGENT_PROVISION);
    });

    it('should support multiple scopes', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { key } = JSON.parse(createResponse.body).data;

      // Verify both scopes are present
      const listResponse = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${key}`,
        },
      });

      const body = JSON.parse(listResponse.body);
      expect(body.data.keys[0].scopes).toEqual(
        expect.arrayContaining([API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ])
      );
    });
  });

  describe('API Key Rotation Flow', () => {
    it('should rotate API key and invalidate old key', async () => {
      // Step 1: Create original key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          name: 'Original Key',
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { id: oldKeyId, key: oldKey } = JSON.parse(createResponse.body).data;

      // Step 2: Verify old key works
      const oldKeyTest = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${oldKey}`,
        },
      });

      expect(oldKeyTest.statusCode).toBe(200);

      // Step 3: Rotate key using JWT (API keys can't rotate themselves)
      const rotateResponse = await server.inject({
        method: 'POST',
        url: `/api-keys/${oldKeyId}/rotate`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      expect(rotateResponse.statusCode).toBe(201);
      const rotateBody = JSON.parse(rotateResponse.body);
      expect(rotateBody.success).toBe(true);
      expect(rotateBody.data.key).toBeDefined();
      expect(rotateBody.data.key).not.toBe(oldKey);
      expect(rotateBody.data.oldKeyId).toBe(oldKeyId);
      expect(rotateBody.data.scopes).toEqual([API_KEY_SCOPES.AGENT_READ]);
      expect(rotateBody.data.name).toBe('Original Key');

      const newKey = rotateBody.data.key;

      // Step 4: Verify old key is now invalid
      const oldKeyInvalidTest = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${oldKey}`,
        },
      });

      expect(oldKeyInvalidTest.statusCode).toBe(401);

      // Step 5: Verify new key works
      const newKeyTest = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${newKey}`,
        },
      });

      expect(newKeyTest.statusCode).toBe(200);
    });

    it('should preserve all properties during rotation', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          name: 'Production Key',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
          expiresAt: futureDate.toISOString(),
          environment: 'live',
        },
      });

      const { id } = JSON.parse(createResponse.body).data;

      const rotateResponse = await server.inject({
        method: 'POST',
        url: `/api-keys/${id}/rotate`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      const body = JSON.parse(rotateResponse.body);
      expect(body.data.name).toBe('Production Key');
      expect(body.data.scopes).toEqual(
        expect.arrayContaining([API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ])
      );
      expect(new Date(body.data.expiresAt).getTime()).toBeCloseTo(futureDate.getTime(), -3);
    });

    it('should fail rotation for non-existent key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys/00000000-0000-0000-0000-000000000000/rotate',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('should fail rotation for already revoked key', async () => {
      // Create and revoke a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { id } = JSON.parse(createResponse.body).data;

      await server.inject({
        method: 'DELETE',
        url: `/api-keys/${id}`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      // Try to rotate revoked key
      const rotateResponse = await server.inject({
        method: 'POST',
        url: `/api-keys/${id}/rotate`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      expect(rotateResponse.statusCode).toBe(400);
      const body = JSON.parse(rotateResponse.body);
      expect(body.code).toBe('INVALID_REQUEST');
    });
  });

  describe('Security Boundaries', () => {
    it('should prevent API keys from creating new API keys', async () => {
      // Create an API key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { key } = JSON.parse(createResponse.body).data;

      // Try to create another API key using the API key (should fail)
      const attemptResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${key}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      expect(attemptResponse.statusCode).toBe(403);
      const body = JSON.parse(attemptResponse.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.error).toContain('API keys cannot be used to create new API keys');
    });

    it('should enforce user ownership for all operations', async () => {
      // Create key for user 1
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { id } = JSON.parse(createResponse.body).data;

      // Create JWT for different user
      const otherUserId = 'other-user-api-key-test';
      const secret = new TextEncoder().encode(jwtSecret);
      const otherJwtToken = await new SignJWT({
        userId: otherUserId,
        email: 'other@example.com',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      // Try to get key as other user (should fail)
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api-keys/${id}`,
        headers: {
          authorization: `Bearer ${otherJwtToken}`,
        },
      });

      expect(getResponse.statusCode).toBe(404);

      // Try to revoke key as other user (should fail)
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api-keys/${id}`,
        headers: {
          authorization: `Bearer ${otherJwtToken}`,
        },
      });

      expect(deleteResponse.statusCode).toBe(404);

      // Try to rotate key as other user (should fail)
      const rotateResponse = await server.inject({
        method: 'POST',
        url: `/api-keys/${id}/rotate`,
        headers: {
          authorization: `Bearer ${otherJwtToken}`,
        },
      });

      expect(rotateResponse.statusCode).toBe(404);
    });

    it('should track last_used_at timestamp on API key usage', async () => {
      // Create key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const { id, key } = JSON.parse(createResponse.body).data;

      // Initial check - last_used_at should be null
      const initialCheck = await server.inject({
        method: 'GET',
        url: `/api-keys/${id}`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      const initialBody = JSON.parse(initialCheck.body);
      expect(initialBody.data.lastUsedAt).toBeNull();

      // Use the API key
      await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${key}`,
        },
      });

      // Small delay to ensure timestamp updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check again - last_used_at should now be set
      const afterUseCheck = await server.inject({
        method: 'GET',
        url: `/api-keys/${id}`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      const afterUseBody = JSON.parse(afterUseCheck.body);
      expect(afterUseBody.data.lastUsedAt).not.toBeNull();
      expect(new Date(afterUseBody.data.lastUsedAt).getTime()).toBeGreaterThan(
        Date.now() - 5000 // Within last 5 seconds
      );
    });
  });

  describe('Live vs Test Environment Keys', () => {
    it('should create live keys by default', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const body = JSON.parse(response.body);
      if (!body.success) {
        console.error('API Error:', body);
      }
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.key).toMatch(/^forj_live_/);
      expect(body.data.environment).toBe('live');
    });

    it('should create test keys when specified', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
          environment: 'test',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.data.key).toMatch(/^forj_test_/);
      expect(body.data.environment).toBe('test');
    });

    it('should preserve environment during rotation', async () => {
      // Create test key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
          environment: 'test',
        },
      });

      const { id } = JSON.parse(createResponse.body).data;

      // Rotate
      const rotateResponse = await server.inject({
        method: 'POST',
        url: `/api-keys/${id}/rotate`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
        },
      });

      const body = JSON.parse(rotateResponse.body);
      expect(body.data.key).toMatch(/^forj_test_/);
    });
  });
});

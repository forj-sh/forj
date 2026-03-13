/**
 * Integration tests for API key management routes
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { API_KEY_SCOPES } from '../../lib/api-key-service.js';
import { db } from '../../lib/database.js';

describe('API Key Routes', () => {
  let server: FastifyInstance;
  let authToken: string;
  const testUserId = 'test-user-api-keys';
  const testEmail = 'test@example.com';
  const jwtSecret = 'test-secret-for-api-key-routes';

  beforeAll(async () => {
    // Set JWT_SECRET for requireAuth middleware
    process.env.JWT_SECRET = jwtSecret;

    // Create server
    server = await createServer();

    // Generate auth token
    const secret = new TextEncoder().encode(jwtSecret);
    authToken = await new SignJWT({ userId: testUserId, email: testEmail })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM api_keys WHERE user_id = $1', [testUserId]);
    await server.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await db.query('DELETE FROM api_keys WHERE user_id = $1', [testUserId]);
  });

  describe('POST /api-keys', () => {
    it('should create an API key with valid scopes', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          name: 'Test Key',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
          environment: 'test',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.key).toMatch(/^forj_test_/); // Test key format
      expect(body.data.scopes).toEqual([API_KEY_SCOPES.AGENT_PROVISION]);
      expect(body.data.name).toBe('Test Key');
      expect(body.data.environment).toBe('test');
    });

    it('should create a live API key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_READ],
          environment: 'live',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.key).toMatch(/^forj_live_/); // Live key format
    });

    it('should create API key with multiple scopes', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.scopes).toHaveLength(2);
      expect(body.data.scopes).toContain(API_KEY_SCOPES.AGENT_PROVISION);
      expect(body.data.scopes).toContain(API_KEY_SCOPES.AGENT_READ);
    });

    it('should reject request without scopes', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          name: 'Invalid Key',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('scope');
    });

    it('should reject invalid scopes', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: ['invalid:scope'],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_SCOPES');
    });

    it('should reject request without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should create API key with expiration date', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
          expiresAt: futureDate.toISOString(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.expiresAt).toBeDefined();
      expect(new Date(body.data.expiresAt).getTime()).toBeCloseTo(
        futureDate.getTime(),
        -3 // Within 1 second
      );
    });

    it('should reject past expiration date', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
          expiresAt: pastDate.toISOString(),
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('future');
    });

    it('should reject invalid date format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
          expiresAt: 'invalid-date',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_DATE');
    });
  });

  describe('GET /api-keys', () => {
    it('should list all API keys for the user', async () => {
      // Create two keys
      await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          name: 'Key 1',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          name: 'Key 2',
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      // List keys
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.keys).toHaveLength(2);
      expect(body.data.keys[0].name).toBeDefined();
      expect(body.data.keys[0].scopes).toBeDefined();
      expect(body.data.keys[0].createdAt).toBeDefined();
    });

    it('should not include revoked keys by default', async () => {
      // Create and revoke a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      const keyId = JSON.parse(createResponse.body).data.id;

      await server.inject({
        method: 'DELETE',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      // List keys (should not include revoked)
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.keys).toHaveLength(0);
    });

    it('should include revoked keys when requested', async () => {
      // Create and revoke a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      const keyId = JSON.parse(createResponse.body).data.id;

      await server.inject({
        method: 'DELETE',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      // List keys with includeRevoked=true
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys?includeRevoked=true',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.keys).toHaveLength(1);
      expect(body.data.keys[0].revokedAt).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api-keys/:id', () => {
    it('should get a specific API key', async () => {
      // Create a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          name: 'Test Key',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      const keyId = JSON.parse(createResponse.body).data.id;

      // Get the key
      const response = await server.inject({
        method: 'GET',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(keyId);
      expect(body.data.name).toBe('Test Key');
    });

    it('should return 404 for non-existent key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api-keys/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('should not allow accessing another user\'s key', async () => {
      // Create a key for the main test user
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          name: 'Belongs to user 1',
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      const keyId = JSON.parse(createResponse.body).data.id;

      // Generate a token for a different user
      const otherUserId = 'other-user-id';
      const secret = new TextEncoder().encode(jwtSecret);
      const otherAuthToken = await new SignJWT({ userId: otherUserId, email: 'other@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      // Try to access the key as the other user
      const response = await server.inject({
        method: 'GET',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${otherAuthToken}`,
        },
      });

      // Should be 404 Not Found because the key doesn't belong to this user
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api-keys/:id', () => {
    it('should revoke an API key', async () => {
      // Create a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      const keyId = JSON.parse(createResponse.body).data.id;

      // Revoke the key
      const response = await server.inject({
        method: 'DELETE',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('revoked');
    });

    it('should return 404 when revoking non-existent key', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api-keys/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should be idempotent (return success when revoking already revoked key)', async () => {
      // Create and revoke a key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api-keys',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      const keyId = JSON.parse(createResponse.body).data.id;

      // Revoke once
      const firstRevoke = await server.inject({
        method: 'DELETE',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(firstRevoke.statusCode).toBe(200);
      const firstBody = JSON.parse(firstRevoke.body);
      expect(firstBody.data.message).toContain('revoked successfully');

      // Try to revoke again (should still return 200)
      const secondRevoke = await server.inject({
        method: 'DELETE',
        url: `/api-keys/${keyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(secondRevoke.statusCode).toBe(200);
      const secondBody = JSON.parse(secondRevoke.body);
      expect(secondBody.success).toBe(true);
      expect(secondBody.data.message).toContain('already revoked');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api-keys/some-id',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});

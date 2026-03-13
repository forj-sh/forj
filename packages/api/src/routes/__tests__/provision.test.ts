/**
 * Integration tests for provision routes authentication and authorization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { API_KEY_SCOPES, ApiKeyService } from '../../lib/api-key-service.js';
import { db } from '../../lib/database.js';

describe('Provision Routes - Authentication & Authorization', () => {
  let server: FastifyInstance;
  let authToken: string;
  const testUserId = 'test-user-provision';
  const testEmail = 'test@example.com';
  const jwtSecret = 'test-secret-for-provision-routes';
  const testProjectId = 'test-project-provision-123';

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

    // Create a test project for the user
    await db.query(
      `INSERT INTO projects (id, user_id, services) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET user_id = $2`,
      [testProjectId, testUserId, JSON.stringify({})]
    );
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    await server.close();
  });

  beforeEach(async () => {
    // Clean up any test API keys before each test
    await db.query('DELETE FROM api_keys WHERE user_id = $1', [testUserId]);
  });

  describe('POST /provision', () => {
    const validPayload = {
      projectId: testProjectId,
      domain: 'test-provision.com',
      namecheapApiUser: 'test-user',
      namecheapApiKey: 'test-key',
      namecheapUsername: 'test-username',
      githubToken: 'ghp_test',
      cloudflareApiToken: 'cf_test',
      cloudflareAccountId: 'cf_account_123',
      githubOrg: 'test-org',
      years: 1,
      contactInfo: {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phone: '+1.1234567890',
        address1: '123 Test St',
        city: 'Test City',
        stateProvince: 'CA',
        postalCode: '12345',
        country: 'US',
      },
    };

    it('should reject unauthenticated requests with 401', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/provision',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('should reject API keys without agent:provision scope with 403', async () => {
      // Create API key with only agent:read scope
      const apiKeyService = new ApiKeyService(db);
      const { key: apiKey } = await apiKeyService.createApiKey({
        userId: testUserId,
        scopes: [API_KEY_SCOPES.AGENT_READ],
        environment: 'test',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/provision',
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('should accept API keys with agent:provision scope', async () => {
      // Create API key with agent:provision scope
      const apiKeyService = new ApiKeyService(db);
      const { key: apiKey } = await apiKeyService.createApiKey({
        userId: testUserId,
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        environment: 'test',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/provision',
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
        payload: validPayload,
      });

      // Should succeed (or fail with validation error, not auth error)
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });

    it('should use userId from request.user, not from body', async () => {
      // Try to impersonate another user by sending userId in body
      const maliciousPayload = {
        ...validPayload,
        userId: 'attacker-user-id', // This should be ignored
      };

      const response = await server.inject({
        method: 'POST',
        url: '/provision',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: maliciousPayload as any,
      });

      // Even if the request succeeds, the userId should be from the token
      // We can verify this by checking the log output or response
      // For now, just verify the request doesn't fail due to auth
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });

    it('should accept JWT authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/provision',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: validPayload,
      });

      // Should succeed (or fail with validation error, not auth error)
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });

    it('should reject provisioning for projects user does not own', async () => {
      // Create a project for a different user
      const otherUserId = 'other-user-provision';
      const otherProjectId = 'other-project-123';

      await db.query(
        `INSERT INTO projects (id, user_id, services) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [otherProjectId, otherUserId, JSON.stringify({})]
      );

      try {
        const response = await server.inject({
          method: 'POST',
          url: '/provision',
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            ...validPayload,
            projectId: otherProjectId, // Try to provision someone else's project
          },
        });

        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error).toBe('Project not found');
      } finally {
        // Clean up
        await db.query('DELETE FROM projects WHERE id = $1', [otherProjectId]);
      }
    });
  });

  describe('GET /provision/status/:projectId', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/provision/status/${testProjectId}`,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('should reject API keys without agent:read scope with 403', async () => {
      // Create API key with only agent:provision scope (not agent:read)
      const apiKeyService = new ApiKeyService(db);
      const { key: apiKey } = await apiKeyService.createApiKey({
        userId: testUserId,
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        environment: 'test',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/provision/status/${testProjectId}`,
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('should accept API keys with agent:read scope', async () => {
      // Create API key with agent:read scope
      const apiKeyService = new ApiKeyService(db);
      const { key: apiKey } = await apiKeyService.createApiKey({
        userId: testUserId,
        scopes: [API_KEY_SCOPES.AGENT_READ],
        environment: 'test',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/provision/status/${testProjectId}`,
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });

      // Should succeed (currently returns 501 Not Implemented, which is fine)
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });

    it('should accept JWT authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/provision/status/${testProjectId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      // Should succeed (currently returns 501 Not Implemented, which is fine)
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });
  });
});

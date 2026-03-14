/**
 * Security tests for authentication endpoints
 *
 * Tests verify that authentication vulnerabilities are properly mitigated:
 * - Mock authentication is disabled in production
 * - Mock authentication requires explicit opt-in in development
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Authentication Security', () => {
  let server: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Set required environment variables for server initialization
    process.env.JWT_SECRET = 'test-secret-key-for-auth-security-tests';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    // Skip Redis dependency for these tests (rate limiter will fail open)
    delete process.env.REDIS_URL;
  });

  afterEach(async () => {
    // Clean up server if it was created
    if (server) {
      await server.close();
    }

    // Restore environment variables by deleting added keys and restoring original values
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.keys(originalEnv).forEach((key) => {
      process.env[key] = originalEnv[key];
    });
  });

  describe('POST /auth/cli - Mock Authentication', () => {
    it('should not register route when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_MOCK_AUTH = 'true'; // Even if explicitly enabled

      server = await createServer();

      const response = await server.inject({
        method: 'POST',
        url: '/auth/cli',
        payload: {
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        },
      });

      // Route should not be registered, so we get 404
      expect(response.statusCode).toBe(404);
    });

    it('should not register route when ENABLE_MOCK_AUTH is not set', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ENABLE_MOCK_AUTH;

      server = await createServer();

      const response = await server.inject({
        method: 'POST',
        url: '/auth/cli',
        payload: {
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should not register route when ENABLE_MOCK_AUTH=false', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_MOCK_AUTH = 'false';

      server = await createServer();

      const response = await server.inject({
        method: 'POST',
        url: '/auth/cli',
        payload: {
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should register and allow mock auth only in development with ENABLE_MOCK_AUTH=true', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_MOCK_AUTH = 'true';

      server = await createServer();

      const response = await server.inject({
        method: 'POST',
        url: '/auth/cli',
        payload: {
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(true);
      expect(data.data.token).toBeTruthy();
      expect(data.data.user.id).toMatch(/^mock-user-/);
    });

    it('should generate unique user IDs for each mock auth request', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_MOCK_AUTH = 'true';

      server = await createServer();

      const response1 = await server.inject({
        method: 'POST',
        url: '/auth/cli',
        payload: {
          deviceId: 'device-1',
          cliVersion: '0.1.0',
        },
      });

      const response2 = await server.inject({
        method: 'POST',
        url: '/auth/cli',
        payload: {
          deviceId: 'device-2',
          cliVersion: '0.1.0',
        },
      });

      const data1 = JSON.parse(response1.body);
      const data2 = JSON.parse(response2.body);

      expect(data1.data.user.id).not.toBe(data2.data.user.id);
      expect(data1.data.token).not.toBe(data2.data.token);
    });
  });

  describe('Production Security Posture', () => {
    it('should prevent route registration in production regardless of ENABLE_MOCK_AUTH value', async () => {
      const testCases = [
        { ENABLE_MOCK_AUTH: 'true' },
        { ENABLE_MOCK_AUTH: 'false' },
        { ENABLE_MOCK_AUTH: undefined },
        { ENABLE_MOCK_AUTH: '1' },
        { ENABLE_MOCK_AUTH: 'yes' },
      ];

      for (const testCase of testCases) {
        // Clean up previous server instance
        if (server) {
          await server.close();
        }

        process.env.NODE_ENV = 'production';
        if (testCase.ENABLE_MOCK_AUTH === undefined) {
          delete process.env.ENABLE_MOCK_AUTH;
        } else {
          process.env.ENABLE_MOCK_AUTH = testCase.ENABLE_MOCK_AUTH;
        }

        server = await createServer();

        const response = await server.inject({
          method: 'POST',
          url: '/auth/cli',
          payload: {
            deviceId: 'test',
            cliVersion: '0.1.0',
          },
        });

        expect(response.statusCode).toBe(404);
      }
    });
  });
});

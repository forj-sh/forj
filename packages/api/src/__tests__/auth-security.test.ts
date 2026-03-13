/**
 * Security tests for authentication endpoints
 *
 * Tests verify that authentication vulnerabilities are properly mitigated:
 * - Mock authentication is disabled in production
 * - Mock authentication requires explicit opt-in in development
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Authentication Security', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('POST /auth/cli - Mock Authentication', () => {
    it('should block mock auth when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_MOCK_AUTH = 'true'; // Even if explicitly enabled

      const response = await fetch('http://localhost:3000/auth/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        }),
      });

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toContain('GitHub Device Flow');
    });

    it('should block mock auth when ENABLE_MOCK_AUTH is not set', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ENABLE_MOCK_AUTH;

      const response = await fetch('http://localhost:3000/auth/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        }),
      });

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
    });

    it('should block mock auth when ENABLE_MOCK_AUTH=false', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_MOCK_AUTH = 'false';

      const response = await fetch('http://localhost:3000/auth/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        }),
      });

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
    });

    it('should allow mock auth only in development with ENABLE_MOCK_AUTH=true', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_MOCK_AUTH = 'true';

      const response = await fetch('http://localhost:3000/auth/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'test-device',
          cliVersion: '0.1.0',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.data.token).toBeTruthy();
      expect(data.data.user.id).toMatch(/^mock-user-/);
    });

    it('should generate unique user IDs for each mock auth request', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_MOCK_AUTH = 'true';

      const response1 = await fetch('http://localhost:3000/auth/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'device-1',
          cliVersion: '0.1.0',
        }),
      });

      const response2 = await fetch('http://localhost:3000/auth/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'device-2',
          cliVersion: '0.1.0',
        }),
      });

      const data1 = await response1.json() as any;
      const data2 = await response2.json() as any;

      expect(data1.data.user.id).not.toBe(data2.data.user.id);
      expect(data1.data.token).not.toBe(data2.data.token);
    });
  });

  describe('Production Security Posture', () => {
    it('should enforce production mode prevents all mock auth attempts', async () => {
      const testCases = [
        { ENABLE_MOCK_AUTH: 'true' },
        { ENABLE_MOCK_AUTH: 'false' },
        { ENABLE_MOCK_AUTH: undefined },
        { ENABLE_MOCK_AUTH: '1' },
        { ENABLE_MOCK_AUTH: 'yes' },
      ];

      for (const testCase of testCases) {
        process.env.NODE_ENV = 'production';
        if (testCase.ENABLE_MOCK_AUTH === undefined) {
          delete process.env.ENABLE_MOCK_AUTH;
        } else {
          process.env.ENABLE_MOCK_AUTH = testCase.ENABLE_MOCK_AUTH;
        }

        const response = await fetch('http://localhost:3000/auth/cli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: 'test',
            cliVersion: '0.1.0',
          }),
        });

        expect(response.status).toBe(404);
        const data = await response.json() as any;
        expect(data.success).toBe(false);
      }
    });
  });
});

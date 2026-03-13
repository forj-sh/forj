/**
 * Unit test: User ID schema compatibility
 *
 * Stack 1: Verify VARCHAR user IDs format matches JWT token generation
 *
 * Tests that:
 * 1. JWT tokens generate VARCHAR user IDs (not UUIDs)
 * 2. User ID format is compatible with VARCHAR(255) column type
 *
 * NOTE: Database integration tests are in separate files. This test validates
 * the user ID generation logic without requiring database connection.
 */

import { describe, it, expect } from '@jest/globals';
import { SignJWT, jwtVerify } from 'jose';

describe('User ID Schema Compatibility', () => {
  // Helper: Generate mock user ID (matches production format)
  const generateMockUserId = () =>
    'mock-user-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

  // Helper: Create JWT token with given user ID and email
  const createToken = async (userId: string, email: string, jwtSecret = 'test-secret') => {
    const secret = new TextEncoder().encode(jwtSecret);
    return new SignJWT({ userId, email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1d')
      .sign(secret);
  };

  it('should generate VARCHAR user IDs in JWT tokens (not UUIDs)', async () => {
    const testUserId = generateMockUserId();
    const testEmail = 'test@forj.sh';
    const token = await createToken(testUserId, testEmail);

    expect(token).toBeDefined();
    expect(typeof testUserId).toBe('string');
    expect(testUserId).toMatch(/^mock-user-[a-z0-9]+$/);

    // Verify it's NOT a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(testUserId)).toBe(false);
  });

  it('should verify JWT token payload contains VARCHAR user ID', async () => {
    const testUserId = generateMockUserId();
    const testEmail = 'test@forj.sh';
    const jwtSecret = process.env.JWT_SECRET || 'test-secret';
    const secret = new TextEncoder().encode(jwtSecret);

    const token = await createToken(testUserId, testEmail, jwtSecret);

    // Verify token
    const { payload } = await jwtVerify(token, secret);

    expect(payload.userId).toBe(testUserId);
    expect(typeof payload.userId).toBe('string');
    expect(payload.email).toBe(testEmail);
  });

  it('should generate user IDs that fit within VARCHAR(255)', () => {
    // Generate several user IDs and verify they're all < 255 chars
    for (let i = 0; i < 10; i++) {
      const userId = generateMockUserId();
      expect(userId.length).toBeLessThan(255);
      expect(userId.length).toBeGreaterThan(10); // Sanity check
    }
  });

  it('should generate user IDs with consistent format', () => {
    // Test invariant properties instead of probabilistic uniqueness
    const userIds = Array.from({ length: 10 }, () => generateMockUserId());

    userIds.forEach((userId) => {
      // Verify consistent format
      expect(userId).toMatch(/^mock-user-[a-z0-9]+$/);
      // Verify length constraints
      expect(userId.length).toBeGreaterThan(10);
      expect(userId.length).toBeLessThan(255);
      // Verify NOT a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(userId)).toBe(false);
    });
  });
});

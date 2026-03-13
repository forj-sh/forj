/**
 * Unit tests for authentication middleware
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SignJWT } from 'jose';
import { requireAuth, requireScopes, type RequestUser, _setApiKeyService } from '../auth.js';
import { API_KEY_SCOPES } from '../../lib/api-key-service.js';

// Mock database pool
const mockQuery = jest.fn();
jest.mock('../../lib/database.js', () => ({
  db: {
    query: mockQuery,
  },
}));

// Create mock API key service
const mockVerifyApiKey = jest.fn() as jest.MockedFunction<any>;
const mockValidateScopes = jest.fn((scopes: string[]) => scopes) as jest.MockedFunction<any>;

const mockApiKeyService = {
  verifyApiKey: mockVerifyApiKey,
  validateScopes: mockValidateScopes,
} as any;

// Helper to create mock request
const createMockRequest = (authHeader?: string): FastifyRequest => {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  } as unknown as FastifyRequest;
};

// Helper to create mock reply
const createMockReply = (): FastifyReply => {
  const reply = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as FastifyReply;
  return reply;
};

// Helper to create valid JWT
async function createJWT(payload: Record<string, any>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'test-secret-key-12345');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

describe('Authentication Middleware', () => {
  beforeEach(() => {
    mockVerifyApiKey.mockClear();
    mockValidateScopes.mockClear();
    mockValidateScopes.mockImplementation((scopes: string[]) => scopes); // Reset to passthrough
    _setApiKeyService(mockApiKeyService); // Inject mock service
    process.env.JWT_SECRET = 'test-secret-key-12345';
  });

  describe('requireAuth - JWT authentication', () => {
    it('should authenticate valid JWT token', async () => {
      const token = await createJWT({ userId: 'user-123', email: 'test@example.com' });
      const request = createMockRequest(`Bearer ${token}`);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(request.user).toBeDefined();
      expect(request.user?.userId).toBe('user-123');
      expect(request.user?.email).toBe('test@example.com');
      expect(request.user?.authMethod).toBe('jwt');
      expect(request.user?.scopes).toBeUndefined();
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject missing authorization header', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing authorization header',
          code: 'UNAUTHORIZED',
        })
      );
    });

    it('should reject empty bearer token', async () => {
      const request = createMockRequest('Bearer ');
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Missing authentication token',
        })
      );
    });

    it('should reject invalid JWT token', async () => {
      const request = createMockRequest('Bearer invalid-token-xyz');
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN',
        })
      );
    });

    it('should reject JWT with missing userId', async () => {
      const token = await createJWT({ email: 'test@example.com' }); // Missing userId
      const request = createMockRequest(`Bearer ${token}`);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid token payload',
          code: 'INVALID_TOKEN',
        })
      );
    });

    it('should reject JWT with missing email', async () => {
      const token = await createJWT({ userId: 'user-123' }); // Missing email
      const request = createMockRequest(`Bearer ${token}`);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid token payload',
        })
      );
    });

    it('should handle token without Bearer prefix', async () => {
      const token = await createJWT({ userId: 'user-123', email: 'test@example.com' });
      const request = createMockRequest(token); // No "Bearer " prefix
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(request.user).toBeDefined();
      expect(request.user?.userId).toBe('user-123');
    });

    it('should return 500 if JWT_SECRET not configured', async () => {
      delete process.env.JWT_SECRET;
      const request = createMockRequest('Bearer some-token');
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication not configured',
          code: 'SERVER_ERROR',
        })
      );
    });
  });

  describe('requireAuth - API key authentication', () => {
    it('should authenticate valid API key', async () => {
      const apiKey = 'forj_live_test123456';
      const request = createMockRequest(`Bearer ${apiKey}`);
      const reply = createMockReply();

      // Set up mock return value
      mockVerifyApiKey.mockResolvedValue({
        valid: true,
        keyRecord: {
          id: 'key-id-123',
          user_id: 'user-456',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        },
      });

      await requireAuth(request, reply);

      expect(mockVerifyApiKey).toHaveBeenCalledWith(apiKey);
      expect(request.user).toBeDefined();
      expect(request.user?.userId).toBe('user-456');
      expect(request.user?.authMethod).toBe('api_key');
      expect(request.user?.scopes).toEqual([API_KEY_SCOPES.AGENT_PROVISION]);
      expect(request.user?.email).toBe(''); // API keys don't have email
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject invalid API key', async () => {
      const apiKey = 'forj_live_invalid';
      const request = createMockRequest(`Bearer ${apiKey}`);
      const reply = createMockReply();

      // Set up mock return value
      mockVerifyApiKey.mockResolvedValue({
        valid: false,
        error: 'Invalid or revoked API key',
      });

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid or revoked API key',
          code: 'INVALID_API_KEY',
        })
      );
    });

    it('should support test API keys', async () => {
      const apiKey = 'forj_test_sandbox123';
      const request = createMockRequest(`Bearer ${apiKey}`);
      const reply = createMockReply();

      // Set up mock return value
      mockVerifyApiKey.mockResolvedValue({
        valid: true,
        keyRecord: {
          id: 'key-id-test',
          user_id: 'user-test',
          scopes: [API_KEY_SCOPES.AGENT_READ],
        },
      });

      await requireAuth(request, reply);

      expect(request.user?.authMethod).toBe('api_key');
      expect(request.user?.scopes).toEqual([API_KEY_SCOPES.AGENT_READ]);
    });

    it('should handle API key verification errors', async () => {
      const apiKey = 'forj_live_test';
      const request = createMockRequest(`Bearer ${apiKey}`);
      const reply = createMockReply();

      // Set up mock to throw error
      mockVerifyApiKey.mockRejectedValue(new Error('Database error'));

      await requireAuth(request, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication error',
          code: 'SERVER_ERROR',
        })
      );
    });

    it('should support multiple scopes', async () => {
      const apiKey = 'forj_live_multiscope';
      const request = createMockRequest(`Bearer ${apiKey}`);
      const reply = createMockReply();

      // Set up mock return value
      mockVerifyApiKey.mockResolvedValue({
        valid: true,
        keyRecord: {
          id: 'key-id-multi',
          user_id: 'user-multi',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
        },
      });

      await requireAuth(request, reply);

      expect(request.user?.scopes).toEqual([
        API_KEY_SCOPES.AGENT_PROVISION,
        API_KEY_SCOPES.AGENT_READ,
      ]);
    });
  });

  describe('requireScopes middleware', () => {
    it('should allow JWT users regardless of scopes', async () => {
      const request = createMockRequest();
      request.user = {
        userId: 'user-123',
        email: 'test@example.com',
        authMethod: 'jwt',
      };
      const reply = createMockReply();

      const middleware = requireScopes([API_KEY_SCOPES.AGENT_PROVISION]);
      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should allow API key with required scope', async () => {
      const request = createMockRequest();
      request.user = {
        userId: 'user-456',
        email: '',
        authMethod: 'api_key',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
      };
      const reply = createMockReply();

      const middleware = requireScopes([API_KEY_SCOPES.AGENT_PROVISION]);
      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject API key without required scope', async () => {
      const request = createMockRequest();
      request.user = {
        userId: 'user-456',
        email: '',
        authMethod: 'api_key',
        scopes: [API_KEY_SCOPES.AGENT_READ],
      };
      const reply = createMockReply();

      const middleware = requireScopes([API_KEY_SCOPES.AGENT_PROVISION]);
      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient permissions',
          code: 'FORBIDDEN',
          details: {
            required: [API_KEY_SCOPES.AGENT_PROVISION],
            provided: [API_KEY_SCOPES.AGENT_READ],
          },
        })
      );
    });

    it('should require all scopes when multiple are specified', async () => {
      const request = createMockRequest();
      request.user = {
        userId: 'user-456',
        email: '',
        authMethod: 'api_key',
        scopes: [API_KEY_SCOPES.AGENT_READ], // Missing AGENT_PROVISION
      };
      const reply = createMockReply();

      const middleware = requireScopes([
        API_KEY_SCOPES.AGENT_PROVISION,
        API_KEY_SCOPES.AGENT_READ,
      ]);
      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('should allow API key with all required scopes', async () => {
      const request = createMockRequest();
      request.user = {
        userId: 'user-456',
        email: '',
        authMethod: 'api_key',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
      };
      const reply = createMockReply();

      const middleware = requireScopes([
        API_KEY_SCOPES.AGENT_PROVISION,
        API_KEY_SCOPES.AGENT_READ,
      ]);
      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated requests', async () => {
      const request = createMockRequest();
      // No request.user set
      const reply = createMockReply();

      const middleware = requireScopes([API_KEY_SCOPES.AGENT_PROVISION]);
      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication required',
          code: 'UNAUTHORIZED',
        })
      );
    });
  });
});

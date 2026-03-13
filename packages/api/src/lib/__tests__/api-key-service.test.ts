/**
 * Unit tests for API key service
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Pool } from 'pg';
import {
  ApiKeyService,
  ApiKeyNotFoundError,
  ApiKeyRevokedError,
  API_KEY_SCOPES,
  API_KEY_PREFIXES,
  KEY_HINT_LENGTH,
  type CreateApiKeyOptions,
  type ApiKeyRecord,
} from '../api-key-service.js';

// Mock Pool
const createMockPool = () => {
  const mockQuery = jest.fn();
  return {
    query: mockQuery,
  } as unknown as Pool;
};

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let mockPool: Pool;
  let mockQuery: jest.MockedFunction<any>;

  beforeEach(() => {
    mockPool = createMockPool();
    mockQuery = mockPool.query as jest.MockedFunction<any>;
    service = new ApiKeyService(mockPool, 4); // Lower bcrypt rounds for faster tests
  });

  describe('validateScopes', () => {
    it('should accept valid scopes', () => {
      const scopes = [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ];
      const result = service.validateScopes(scopes);
      expect(result).toEqual(scopes);
    });

    it('should accept single scope', () => {
      const scopes = [API_KEY_SCOPES.AGENT_PROVISION];
      const result = service.validateScopes(scopes);
      expect(result).toEqual(scopes);
    });

    it('should reject invalid scopes', () => {
      const scopes = ['invalid:scope'];
      expect(() => service.validateScopes(scopes)).toThrow('Invalid scopes: invalid:scope');
    });

    it('should reject mixed valid and invalid scopes', () => {
      const scopes = [API_KEY_SCOPES.AGENT_PROVISION, 'invalid:scope'];
      expect(() => service.validateScopes(scopes)).toThrow('Invalid scopes: invalid:scope');
    });

    it('should reject empty scope array', () => {
      expect(() => service.validateScopes([])).toThrow('At least one scope is required');
    });
  });

  describe('generateKey', () => {
    it('should generate key with live prefix by default', () => {
      const key = service.generateKey();
      expect(key).toMatch(/^forj_live_[A-Za-z0-9_-]+$/);
    });

    it('should generate key with test prefix when specified', () => {
      const key = service.generateKey(API_KEY_PREFIXES.TEST);
      expect(key).toMatch(/^forj_test_[A-Za-z0-9_-]+$/);
    });

    it('should generate unique keys', () => {
      const key1 = service.generateKey();
      const key2 = service.generateKey();
      expect(key1).not.toBe(key2);
    });

    it('should generate keys with sufficient entropy', () => {
      const key = service.generateKey();
      // After prefix, should have ~43 base64url chars (32 bytes)
      expect(key.length).toBeGreaterThan(40);
    });
  });

  describe('hashKey', () => {
    it('should hash a key', async () => {
      const key = 'forj_live_test123';
      const hash = await service.hashKey(key);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(key);
      expect(hash).toMatch(/^\$2[ayb]\$/); // bcrypt hash format
    });

    it('should produce different hashes for same key (bcrypt salt)', async () => {
      const key = 'forj_live_test123';
      const hash1 = await service.hashKey(key);
      const hash2 = await service.hashKey(key);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyKeyHash', () => {
    it('should verify correct key against hash', async () => {
      const key = 'forj_live_test123';
      const hash = await service.hashKey(key);
      const isValid = await service.verifyKeyHash(key, hash);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect key', async () => {
      const key = 'forj_live_test123';
      const hash = await service.hashKey(key);
      const isValid = await service.verifyKeyHash('forj_live_wrong', hash);

      expect(isValid).toBe(false);
    });
  });

  describe('createApiKey', () => {
    it('should create an API key with valid options', async () => {
      const options: CreateApiKeyOptions = {
        userId: 'user-123',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: 'Test Key',
      };

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: 'hash',
        key_hint: 'testhint',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: 'Test Key',
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await service.createApiKey(options);

      expect(result.id).toBe('key-id-123');
      expect(result.userId).toBe('user-123');
      expect(result.scopes).toEqual([API_KEY_SCOPES.AGENT_PROVISION]);
      expect(result.name).toBe('Test Key');
      expect(result.key).toMatch(/^forj_live_/);

      // Verify database was called correctly
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [query, params] = mockQuery.mock.calls[0];
      expect(query).toContain('key_hint');
      expect(params[0]).toBe('user-123'); // user_id
      // params[1] is key_hash (bcrypt hash)
      // params[2] is key_hint (first 8 chars of secret)
      expect(typeof params[2]).toBe('string');
      expect(params[2].length).toBe(KEY_HINT_LENGTH);
      expect(params[3]).toEqual([API_KEY_SCOPES.AGENT_PROVISION]); // scopes
      expect(params[4]).toBe('Test Key'); // name
    });

    it('should create test key when environment is test', async () => {
      const options: CreateApiKeyOptions = {
        userId: 'user-123',
        scopes: [API_KEY_SCOPES.AGENT_READ],
        environment: 'test',
      };

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: 'hash',
        key_hint: 'testhint',
        scopes: [API_KEY_SCOPES.AGENT_READ],
        name: null,
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await service.createApiKey(options);

      expect(result.key).toMatch(/^forj_test_/);
    });

    it('should reject invalid scopes', async () => {
      const options = {
        userId: 'user-123',
        scopes: ['invalid:scope'] as any,
      };

      await expect(service.createApiKey(options)).rejects.toThrow('Invalid scopes');
    });

    it('should handle expiration date', async () => {
      const expiresAt = new Date('2026-12-31');
      const options: CreateApiKeyOptions = {
        userId: 'user-123',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        expiresAt,
      };

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: 'hash',
        key_hint: 'testhint',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: null,
        created_at: new Date(),
        expires_at: expiresAt,
        last_used_at: null,
        revoked_at: null,
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await service.createApiKey(options);

      expect(result.expiresAt).toEqual(expiresAt);
    });

    it('should support multiple scopes', async () => {
      const options: CreateApiKeyOptions = {
        userId: 'user-123',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
      };

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: 'hash',
        key_hint: 'testhint',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
        name: null,
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await service.createApiKey(options);

      expect(result.scopes).toEqual([API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ]);
    });
  });

  describe('verifyApiKey', () => {
    it('should verify a valid API key', async () => {
      const key = service.generateKey();
      const hash = await service.hashKey(key);
      const keyHint = key.substring(API_KEY_PREFIXES.LIVE.length, API_KEY_PREFIXES.LIVE.length + KEY_HINT_LENGTH);

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: hash,
        key_hint: keyHint,
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: null,
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
      };

      // Mock SELECT query (should use key_hint in WHERE clause)
      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });
      // Mock fire-and-forget UPDATE query for last_used_at
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.verifyApiKey(key);

      expect(result.valid).toBe(true);
      expect(result.keyRecord).toBeDefined();
      expect(result.keyRecord?.id).toBe('key-id-123');

      // Verify query used key_hint for efficient lookup
      expect(mockQuery).toHaveBeenCalledTimes(2); // SELECT + UPDATE
      const [query, params] = mockQuery.mock.calls[0];
      expect(query).toContain('key_hint');
      expect(params[0]).toBe(keyHint);
    });

    it('should reject invalid key format', async () => {
      const result = await service.verifyApiKey('invalid-key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid key format');
    });

    it('should reject revoked keys', async () => {
      const key = service.generateKey();
      const hash = await service.hashKey(key);
      const keyHint = key.substring(API_KEY_PREFIXES.LIVE.length, API_KEY_PREFIXES.LIVE.length + KEY_HINT_LENGTH);

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: hash,
        key_hint: keyHint,
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: null,
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: new Date(), // Revoked
      };

      // Query filters out revoked keys, so returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.verifyApiKey(key);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or revoked API key');
    });

    it('should reject expired keys', async () => {
      const key = service.generateKey();

      // Query filters out expired keys, so returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.verifyApiKey(key);

      expect(result.valid).toBe(false);
    });

    it('should reject wrong key', async () => {
      const correctKey = service.generateKey();
      const wrongKey = service.generateKey();
      const hash = await service.hashKey(correctKey);
      const wrongKeyHint = wrongKey.substring(API_KEY_PREFIXES.LIVE.length, API_KEY_PREFIXES.LIVE.length + KEY_HINT_LENGTH);

      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: hash,
        key_hint: wrongKeyHint,
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: null,
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await service.verifyApiKey(wrongKey);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or revoked API key');
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an API key', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.revokeApiKey('key-id-123', 'user-123');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const [query, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['key-id-123', 'user-123']);
    });

    it('should return false if key not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.revokeApiKey('key-id-999', 'user-123');

      expect(result).toBe(false);
    });

    it('should return false if key belongs to different user', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.revokeApiKey('key-id-123', 'user-999');

      expect(result).toBe(false);
    });
  });

  describe('listApiKeys', () => {
    it('should list active keys by default', async () => {
      const mockRecords: ApiKeyRecord[] = [
        {
          id: 'key-1',
          user_id: 'user-123',
          key_hash: 'hash1',
          key_hint: 'hint1abc',
          scopes: [API_KEY_SCOPES.AGENT_PROVISION],
          name: 'Key 1',
          created_at: new Date(),
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        },
        {
          id: 'key-2',
          user_id: 'user-123',
          key_hash: 'hash2',
          key_hint: 'hint2def',
          scopes: [API_KEY_SCOPES.AGENT_READ],
          name: 'Key 2',
          created_at: new Date(),
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockRecords });

      const result = await service.listApiKeys('user-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('key-1');
      expect(result[1].id).toBe('key-2');

      // Verify query filters out revoked keys
      const [query] = mockQuery.mock.calls[0];
      expect(query).toContain('revoked_at IS NULL');
    });

    it('should include revoked keys when requested', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.listApiKeys('user-123', true);

      const [query] = mockQuery.mock.calls[0];
      expect(query).not.toContain('revoked_at IS NULL');
    });
  });

  describe('getApiKey', () => {
    it('should get a key by ID', async () => {
      const mockRecord: ApiKeyRecord = {
        id: 'key-id-123',
        user_id: 'user-123',
        key_hash: 'hash',
        key_hint: 'testhint',
        scopes: [API_KEY_SCOPES.AGENT_PROVISION],
        name: 'Test Key',
        created_at: new Date(),
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRecord] });

      const result = await service.getApiKey('key-id-123', 'user-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('key-id-123');
    });

    it('should return null if key not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.getApiKey('key-id-999', 'user-123');

      expect(result).toBeNull();
    });

    it('should enforce user ownership', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.getApiKey('key-id-123', 'user-999');

      expect(result).toBeNull();

      const [, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['key-id-123', 'user-999']);
    });
  });

  describe('rotateApiKey', () => {
    const mockExistingKey: ApiKeyRecord = {
      id: 'key-id-123',
      user_id: 'user-123',
      key_hash: 'hash123',
      key_hint: 'forj_liv', // First 8 chars of live key (used to infer environment)
      scopes: [API_KEY_SCOPES.AGENT_PROVISION],
      name: 'Production Key',
      created_at: new Date('2024-01-01'),
      expires_at: new Date('2025-01-01'),
      last_used_at: null,
      revoked_at: null,
    };

    it('should rotate an API key successfully', async () => {
      // Mock getApiKey (verify ownership)
      mockQuery.mockResolvedValueOnce({ rows: [mockExistingKey] });

      // Mock revokeApiKey
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      // Mock createApiKey
      const mockNewKeyId = 'new-key-id-456';
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: mockNewKeyId,
            user_id: 'user-123',
            scopes: [API_KEY_SCOPES.AGENT_PROVISION],
            name: 'Production Key',
            created_at: new Date(),
            expires_at: new Date('2025-01-01'),
          },
        ],
      });

      const result = await service.rotateApiKey('key-id-123', 'user-123');

      expect(result.id).toBe(mockNewKeyId);
      expect(result.oldKeyId).toBe('key-id-123');
      expect(result.scopes).toEqual([API_KEY_SCOPES.AGENT_PROVISION]);
      expect(result.name).toBe('Production Key');
      expect(result.key).toMatch(/^forj_live_/);

      // Verify query calls: getApiKey, revokeApiKey, createApiKey
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('should throw error if key not found', async () => {
      // Mock getApiKey returns null
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(service.rotateApiKey('key-id-999', 'user-123')).rejects.toThrow(
        ApiKeyNotFoundError
      );

      expect(mockQuery).toHaveBeenCalledTimes(1); // Only getApiKey called
    });

    it('should throw error if key belongs to different user', async () => {
      // Mock getApiKey returns empty (no match for user-999)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(service.rotateApiKey('key-id-123', 'user-999')).rejects.toThrow(
        ApiKeyNotFoundError
      );
    });

    it('should throw error if key is already revoked', async () => {
      const revokedKey = { ...mockExistingKey, revoked_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [revokedKey] });

      await expect(service.rotateApiKey('key-id-123', 'user-123')).rejects.toThrow(
        ApiKeyRevokedError
      );

      expect(mockQuery).toHaveBeenCalledTimes(1); // Only getApiKey called
    });

    it('should preserve expiration date from old key', async () => {
      const expiresAt = new Date('2025-06-01');
      const keyWithExpiry = { ...mockExistingKey, expires_at: expiresAt };

      // Mock getApiKey
      mockQuery.mockResolvedValueOnce({ rows: [keyWithExpiry] });

      // Mock revokeApiKey
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      // Mock createApiKey
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-key-id-456',
            user_id: 'user-123',
            scopes: [API_KEY_SCOPES.AGENT_PROVISION],
            name: 'Production Key',
            created_at: new Date(),
            expires_at: expiresAt,
          },
        ],
      });

      const result = await service.rotateApiKey('key-id-123', 'user-123');

      expect(result.expiresAt).toEqual(expiresAt);
    });

    it('should preserve all scopes from old key', async () => {
      const multiScopeKey = {
        ...mockExistingKey,
        scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
      };

      // Mock getApiKey
      mockQuery.mockResolvedValueOnce({ rows: [multiScopeKey] });

      // Mock revokeApiKey
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      // Mock createApiKey - preserve expires_at from multiScopeKey
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-key-id-456',
            user_id: 'user-123',
            scopes: [API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ],
            name: 'Production Key',
            created_at: new Date(),
            expires_at: multiScopeKey.expires_at,
          },
        ],
      });

      const result = await service.rotateApiKey('key-id-123', 'user-123');

      expect(result.scopes).toEqual([API_KEY_SCOPES.AGENT_PROVISION, API_KEY_SCOPES.AGENT_READ]);
    });

    it('should handle key without name', async () => {
      const unnamedKey = { ...mockExistingKey, name: null };

      // Mock getApiKey
      mockQuery.mockResolvedValueOnce({ rows: [unnamedKey] });

      // Mock revokeApiKey
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      // Mock createApiKey - preserve expires_at from unnamedKey
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'new-key-id-456',
            user_id: 'user-123',
            scopes: [API_KEY_SCOPES.AGENT_PROVISION],
            name: null,
            created_at: new Date(),
            expires_at: unnamedKey.expires_at,
          },
        ],
      });

      const result = await service.rotateApiKey('key-id-123', 'user-123');

      expect(result.name).toBeNull();
    });

    it('should throw error if revocation fails', async () => {
      // Mock getApiKey
      mockQuery.mockResolvedValueOnce({ rows: [mockExistingKey] });

      // Mock revokeApiKey failure (rowCount = 0)
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.rotateApiKey('key-id-123', 'user-123')).rejects.toThrow(
        'Failed to revoke old API key'
      );
    });
  });
});

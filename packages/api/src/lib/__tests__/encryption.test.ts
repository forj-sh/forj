/**
 * Unit tests for encryption utilities
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { encrypt, decrypt, generateEncryptionKey, isValidEncryptionKey } from '../encryption.js';

describe('Encryption', () => {
  let testKey: string;

  beforeAll(() => {
    // Generate a test key
    testKey = generateEncryptionKey();
  });

  describe('generateEncryptionKey', () => {
    it('should generate a valid 256-bit base64 key', () => {
      const key = generateEncryptionKey();
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');

      // Decode and check length (32 bytes = 256 bits)
      const keyBuffer = Buffer.from(key, 'base64');
      expect(keyBuffer.length).toBe(32);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('isValidEncryptionKey', () => {
    it('should validate correct 256-bit keys', () => {
      const validKey = generateEncryptionKey();
      expect(isValidEncryptionKey(validKey)).toBe(true);
    });

    it('should reject invalid base64', () => {
      expect(isValidEncryptionKey('not-valid-base64!!!')).toBe(false);
    });

    it('should reject keys with wrong length', () => {
      // 16 bytes instead of 32
      const shortKey = Buffer.from('0123456789abcdef').toString('base64');
      expect(isValidEncryptionKey(shortKey)).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidEncryptionKey('')).toBe(false);
    });
  });

  describe('encrypt', () => {
    it('should encrypt a string', async () => {
      const plaintext = 'secret-api-token-12345';
      const encrypted = await encrypt(plaintext, testKey);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':').length).toBe(4); // salt:iv:authTag:ciphertext
    });

    it('should produce different output for same input (due to random IV)', async () => {
      const plaintext = 'secret-api-token';
      const encrypted1 = await encrypt(plaintext, testKey);
      const encrypted2 = await encrypt(plaintext, testKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw error for empty plaintext', async () => {
      await expect(encrypt('', testKey)).rejects.toThrow('Plaintext cannot be empty');
    });

    it('should throw error for missing key', async () => {
      await expect(encrypt('test', '')).rejects.toThrow('Encryption key is required');
    });

    it('should throw error for invalid key length', async () => {
      const invalidKey = Buffer.from('short').toString('base64');
      await expect(encrypt('test', invalidKey)).rejects.toThrow('Encryption key must be 256 bits');
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted data', async () => {
      const plaintext = 'secret-cloudflare-token';
      const encrypted = await encrypt(plaintext, testKey);
      const decrypted = await decrypt(encrypted, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', async () => {
      const plaintext = 'token-with-special-chars: !@#$%^&*()_+-={}[]|\\:";\'<>?,./';
      const encrypted = await encrypt(plaintext, testKey);
      const decrypted = await decrypt(encrypted, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', async () => {
      const plaintext = 'token-日本語-emoji-🔐-test';
      const encrypted = await encrypt(plaintext, testKey);
      const decrypted = await decrypt(encrypted, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = await encrypt(plaintext, testKey);
      const decrypted = await decrypt(encrypted, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error for tampered data', async () => {
      const plaintext = 'secret-token';
      const encrypted = await encrypt(plaintext, testKey);

      // Tamper with the ciphertext
      const parts = encrypted.split(':');
      parts[3] = parts[3].slice(0, -5) + 'XXXXX';
      const tampered = parts.join(':');

      await expect(decrypt(tampered, testKey)).rejects.toThrow();
    });

    it('should throw error for wrong key', async () => {
      const plaintext = 'secret-token';
      const encrypted = await encrypt(plaintext, testKey);
      const wrongKey = generateEncryptionKey();

      await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
    });

    it('should throw error for empty encrypted data', async () => {
      await expect(decrypt('', testKey)).rejects.toThrow('Encrypted data cannot be empty');
    });

    it('should throw error for invalid format', async () => {
      await expect(decrypt('invalid-format', testKey)).rejects.toThrow('Invalid encrypted data format');
    });

    it('should throw error for missing key', async () => {
      const encrypted = await encrypt('test', testKey);
      await expect(decrypt(encrypted, '')).rejects.toThrow('Encryption key is required');
    });
  });

  describe('encrypt/decrypt roundtrip', () => {
    const testCases = [
      'simple-token',
      'token-with-dashes-and-numbers-123',
      'UPPERCASE-TOKEN',
      'MixedCase-Token-123',
      'token.with.dots',
      'token_with_underscores',
      'very-long-token-' + 'x'.repeat(500),
      '{"json":"object","nested":{"key":"value"}}',
      'cloudflare-api-token-AbCdEf123456',
      'github-oauth-token-gho_1234567890abcdef',
    ];

    testCases.forEach((testCase) => {
      it(`should correctly roundtrip: ${testCase.slice(0, 50)}...`, async () => {
        const encrypted = await encrypt(testCase, testKey);
        const decrypted = await decrypt(encrypted, testKey);
        expect(decrypted).toBe(testCase);
      });
    });
  });
});

/**
 * Unit tests for Cloudflare error handling
 */

import { describe, it, expect } from '@jest/globals';
import {
  CloudflareApiError,
  CloudflareErrorCategory,
  categorizeError,
  ERROR_CODE_MAP,
} from '../errors.js';
import type { CloudflareApiError as CloudflareApiErrorType } from '../types.js';

describe('Cloudflare Error Handling', () => {
  describe('categorizeError', () => {
    it('should categorize AUTH errors (1000-1999)', () => {
      expect(categorizeError(1000)).toBe(CloudflareErrorCategory.AUTH);
      expect(categorizeError(1001)).toBe(CloudflareErrorCategory.AUTH);
      expect(categorizeError(1012)).toBe(CloudflareErrorCategory.AUTH);
      expect(categorizeError(1999)).toBe(CloudflareErrorCategory.AUTH);
    });

    it('should categorize VALIDATION errors (9000-9999)', () => {
      expect(categorizeError(9000)).toBe(CloudflareErrorCategory.VALIDATION);
      expect(categorizeError(9001)).toBe(CloudflareErrorCategory.VALIDATION);
      expect(categorizeError(9999)).toBe(CloudflareErrorCategory.VALIDATION);
    });

    it('should categorize RATE_LIMIT errors (10000+)', () => {
      expect(categorizeError(10000)).toBe(CloudflareErrorCategory.RATE_LIMIT);
      expect(categorizeError(10001)).toBe(CloudflareErrorCategory.RATE_LIMIT);
      expect(categorizeError(99999)).toBe(CloudflareErrorCategory.RATE_LIMIT);
    });

    it('should categorize ZONE_EXISTS error (1061)', () => {
      expect(categorizeError(1061)).toBe(CloudflareErrorCategory.ZONE_EXISTS);
    });

    it('should categorize unknown error codes as UNKNOWN', () => {
      expect(categorizeError(5000)).toBe(CloudflareErrorCategory.UNKNOWN);
      expect(categorizeError(2500)).toBe(CloudflareErrorCategory.UNKNOWN);
      expect(categorizeError(0)).toBe(CloudflareErrorCategory.UNKNOWN);
    });
  });

  describe('CloudflareApiError', () => {
    it('should create error with single error object', () => {
      const apiErrors: CloudflareApiErrorType[] = [
        { code: 1001, message: 'Invalid API token' },
      ];

      const error = new CloudflareApiError(apiErrors);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CloudflareApiError);
      expect(error.name).toBe('CloudflareApiError');
      expect(error.category).toBe(CloudflareErrorCategory.AUTH);
      expect(error.message).toContain('[AUTH]');
      expect(error.message).toContain('[1001]');
      expect(error.message).toContain('Invalid API token');
    });

    it('should create error with multiple error objects', () => {
      const apiErrors: CloudflareApiErrorType[] = [
        { code: 1001, message: 'Invalid API token' },
        { code: 1003, message: 'Insufficient permissions' },
      ];

      const error = new CloudflareApiError(apiErrors);

      expect(error.errors).toHaveLength(2);
      expect(error.message).toContain('[1001]');
      expect(error.message).toContain('[1003]');
      expect(error.category).toBe(CloudflareErrorCategory.AUTH);
    });

    it('should allow manual category override', () => {
      const apiErrors: CloudflareApiErrorType[] = [
        { code: 1001, message: 'Test error' },
      ];

      const error = new CloudflareApiError(apiErrors, CloudflareErrorCategory.NETWORK);

      expect(error.category).toBe(CloudflareErrorCategory.NETWORK);
    });

    it('should handle empty errors array', () => {
      const error = new CloudflareApiError([]);

      expect(error.category).toBe(CloudflareErrorCategory.UNKNOWN);
      expect(error.errors).toHaveLength(0);
    });
  });

  describe('isRetryable', () => {
    it('should mark NETWORK errors as retryable', () => {
      const error = new CloudflareApiError(
        [{ code: 0, message: 'Network error' }],
        CloudflareErrorCategory.NETWORK
      );

      expect(error.isRetryable()).toBe(true);
    });

    it('should mark RATE_LIMIT errors as retryable', () => {
      const error = new CloudflareApiError([
        { code: 10000, message: 'Rate limit exceeded' },
      ]);

      expect(error.isRetryable()).toBe(true);
    });

    it('should mark UNKNOWN errors as retryable', () => {
      const error = new CloudflareApiError([
        { code: 5000, message: 'Unknown error' },
      ]);

      expect(error.isRetryable()).toBe(true);
    });

    it('should mark AUTH errors as non-retryable', () => {
      const error = new CloudflareApiError([
        { code: 1001, message: 'Invalid API token' },
      ]);

      expect(error.isRetryable()).toBe(false);
    });

    it('should mark VALIDATION errors as non-retryable', () => {
      const error = new CloudflareApiError([
        { code: 9001, message: 'Invalid zone name' },
      ]);

      expect(error.isRetryable()).toBe(false);
    });

    it('should mark ZONE_EXISTS errors as non-retryable', () => {
      const error = new CloudflareApiError([
        { code: 1061, message: 'Zone already exists' },
      ]);

      expect(error.isRetryable()).toBe(false);
    });
  });

  describe('getUserMessage', () => {
    it('should return user-friendly message for AUTH errors', () => {
      const error = new CloudflareApiError([
        { code: 1001, message: 'Invalid API token' },
      ]);

      expect(error.getUserMessage()).toBe(
        'Cloudflare authentication failed — please verify your API token.'
      );
    });

    it('should return user-friendly message for VALIDATION errors', () => {
      const error = new CloudflareApiError([
        { code: 9001, message: 'Invalid zone name' },
      ]);

      expect(error.getUserMessage()).toBe(
        'Invalid input — please check your domain configuration.'
      );
    });

    it('should return user-friendly message for ZONE_EXISTS errors', () => {
      const error = new CloudflareApiError([
        { code: 1061, message: 'Zone already exists' },
      ]);

      expect(error.getUserMessage()).toBe(
        'This domain is already configured in Cloudflare.'
      );
    });

    it('should return user-friendly message for RATE_LIMIT errors', () => {
      const error = new CloudflareApiError([
        { code: 10000, message: 'Rate limit exceeded' },
      ]);

      expect(error.getUserMessage()).toBe(
        'Rate limit exceeded — retrying automatically.'
      );
    });

    it('should return user-friendly message for NETWORK errors', () => {
      const error = new CloudflareApiError(
        [{ code: 0, message: 'Network error' }],
        CloudflareErrorCategory.NETWORK
      );

      expect(error.getUserMessage()).toBe(
        'Network error — retrying automatically.'
      );
    });

    it('should return user-friendly message for UNKNOWN errors', () => {
      const error = new CloudflareApiError([
        { code: 5000, message: 'Unknown error' },
      ]);

      expect(error.getUserMessage()).toBe(
        'Unexpected error — our team has been notified.'
      );
    });
  });

  describe('ERROR_CODE_MAP', () => {
    it('should contain common error codes', () => {
      expect(ERROR_CODE_MAP[1000]).toBeDefined();
      expect(ERROR_CODE_MAP[1001]).toBeDefined();
      expect(ERROR_CODE_MAP[1061]).toBe('Zone already exists');
      expect(ERROR_CODE_MAP[9001]).toBeDefined();
      expect(ERROR_CODE_MAP[10000]).toBeDefined();
    });

    it('should have human-readable descriptions', () => {
      expect(ERROR_CODE_MAP[1001]).toContain('API token');
      expect(ERROR_CODE_MAP[1061]).toContain('already exists');
      expect(ERROR_CODE_MAP[9001]).toContain('zone name');
      expect(ERROR_CODE_MAP[10000]).toContain('Rate limit');
    });
  });
});

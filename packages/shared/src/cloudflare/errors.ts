/**
 * Cloudflare API error handling
 *
 * Error categorization based on Cloudflare error codes
 * Reference: https://developers.cloudflare.com/api/operations/zones-get
 */

import type { CloudflareApiError as CloudflareApiErrorType } from './types.js';

/**
 * Error categories for Cloudflare API errors
 */
export enum CloudflareErrorCategory {
  /** Authentication/authorization errors (1000-1999) */
  AUTH = 'AUTH',

  /** Input validation errors (9000-9999) */
  VALIDATION = 'VALIDATION',

  /** Zone already exists (1061) */
  ZONE_EXISTS = 'ZONE_EXISTS',

  /** Rate limiting errors (10000+) */
  RATE_LIMIT = 'RATE_LIMIT',

  /** Network/connection errors */
  NETWORK = 'NETWORK',

  /** Unknown errors */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Cloudflare API error class
 */
export class CloudflareApiError extends Error {
  public readonly errors: CloudflareApiErrorType[];
  public readonly category: CloudflareErrorCategory;

  constructor(errors: CloudflareApiErrorType[], category?: CloudflareErrorCategory) {
    const errorMessages = errors.map(e => `[${e.code}] ${e.message}`).join('; ');
    const detectedCategory = category || categorizeError(errors[0]?.code || 0);

    super(`Cloudflare API error [${detectedCategory}]: ${errorMessages}`);

    this.name = 'CloudflareApiError';
    this.errors = errors;
    this.category = detectedCategory;

    // Maintain proper stack trace for debugging
    Error.captureStackTrace(this, CloudflareApiError);
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    switch (this.category) {
      case CloudflareErrorCategory.NETWORK:
        return true;  // Network errors are retryable
      case CloudflareErrorCategory.RATE_LIMIT:
        return true;  // Rate limit errors should be retried with backoff
      case CloudflareErrorCategory.AUTH:
      case CloudflareErrorCategory.VALIDATION:
      case CloudflareErrorCategory.ZONE_EXISTS:
        return false; // These are terminal errors
      case CloudflareErrorCategory.UNKNOWN:
        return true;  // Unknown errors might be transient
      default:
        return false;
    }
  }

  /**
   * Get user-facing error message
   */
  getUserMessage(): string {
    switch (this.category) {
      case CloudflareErrorCategory.AUTH:
        return 'Cloudflare authentication failed — please verify your API token.';
      case CloudflareErrorCategory.VALIDATION:
        return 'Invalid input — please check your domain configuration.';
      case CloudflareErrorCategory.ZONE_EXISTS:
        return 'This domain is already configured in Cloudflare.';
      case CloudflareErrorCategory.RATE_LIMIT:
        return 'Rate limit exceeded — retrying automatically.';
      case CloudflareErrorCategory.NETWORK:
        return 'Network error — retrying automatically.';
      case CloudflareErrorCategory.UNKNOWN:
        return 'Unexpected error — our team has been notified.';
      default:
        return 'An error occurred — please try again.';
    }
  }
}

/**
 * Categorize an error based on its error code
 *
 * Cloudflare error code ranges:
 * - 1007, 1061: Special cases (rate limit, zone exists)
 * - 1000-1999: Authentication/authorization (except 1007)
 * - 9000-9999: Validation errors
 * - 10000+: Rate limiting
 */
export function categorizeError(errorCode: number): CloudflareErrorCategory {
  // Rate limit (specific error code - check before AUTH range)
  if (errorCode === 1007) {
    return CloudflareErrorCategory.RATE_LIMIT;
  }

  // ZONE_EXISTS (specific error code - check before AUTH range)
  if (errorCode === 1061) {
    return CloudflareErrorCategory.ZONE_EXISTS;
  }

  // AUTH errors (1000-1999, except 1007)
  if (errorCode >= 1000 && errorCode < 2000) {
    return CloudflareErrorCategory.AUTH;
  }

  // VALIDATION errors (9000-9999)
  if (errorCode >= 9000 && errorCode < 10000) {
    return CloudflareErrorCategory.VALIDATION;
  }

  // RATE_LIMIT errors (10000+)
  if (errorCode >= 10000) {
    return CloudflareErrorCategory.RATE_LIMIT;
  }

  // Map HTTP status codes to categories (when Cloudflare doesn't return structured error codes)
  if (errorCode === 401 || errorCode === 403) {
    return CloudflareErrorCategory.AUTH;
  }

  // Default to UNKNOWN for unrecognized codes
  return CloudflareErrorCategory.UNKNOWN;
}

/**
 * Map of specific error codes to human-readable descriptions
 */
export const ERROR_CODE_MAP: Record<number, string> = {
  // Authentication errors (1000-1999)
  1000: 'Invalid request (generic)',
  1001: 'Invalid or missing API token',
  1002: 'Invalid API key',
  1003: 'Insufficient permissions',
  1004: 'Invalid API token or key',
  1005: 'Method not allowed',
  1006: 'Invalid request headers',
  1007: 'Rate limited',
  1008: 'Request timeout',
  1009: 'Account not found',
  1010: 'Account suspended',
  1011: 'Account disabled',
  1012: 'Account locked',

  // Zone errors
  1061: 'Zone already exists',
  1097: 'Zone not found',
  1098: 'Zone locked',

  // Validation errors (9000-9999)
  9000: 'Validation error (generic)',
  9001: 'Invalid zone name',
  9002: 'Invalid record type',
  9003: 'Invalid record content',
  9004: 'Invalid TTL value',
  9005: 'Invalid priority value',
  9006: 'Missing required field',
  9007: 'Field value too long',
  9008: 'Invalid field format',

  // Rate limiting (10000+)
  10000: 'Rate limit exceeded',
  10001: 'Too many requests',
};

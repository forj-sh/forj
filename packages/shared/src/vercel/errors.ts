/**
 * Vercel API error handling
 *
 * Error categorization based on Vercel API responses
 * Reference: https://vercel.com/docs/rest-api/errors
 */

import type { VercelApiErrorDetail } from './types.js';

/**
 * Error categories for Vercel API errors
 */
export enum VercelErrorCategory {
  /** Authentication/authorization errors (401, 403) */
  AUTH = 'AUTH',

  /** Input validation errors (400, 422) */
  VALIDATION = 'VALIDATION',

  /** Resource already exists (409) */
  CONFLICT = 'CONFLICT',

  /** Rate limiting errors (429) */
  RATE_LIMIT = 'RATE_LIMIT',

  /** Not found (404) */
  NOT_FOUND = 'NOT_FOUND',

  /** Network/connection errors */
  NETWORK = 'NETWORK',

  /** Server-side errors (5xx) */
  SERVER = 'SERVER',

  /** Unknown errors */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Vercel API error class
 */
export class VercelApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly category: VercelErrorCategory;

  constructor(
    statusCode: number,
    errorDetail: VercelApiErrorDetail,
    category?: VercelErrorCategory,
  ) {
    const detectedCategory = category || categorizeByStatus(statusCode);
    super(`Vercel API error [${detectedCategory}]: [${statusCode}] ${errorDetail.code}: ${errorDetail.message}`);

    this.name = 'VercelApiError';
    this.statusCode = statusCode;
    this.errorCode = errorDetail.code;
    this.category = detectedCategory;

    Error.captureStackTrace(this, VercelApiError);
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    switch (this.category) {
      case VercelErrorCategory.NETWORK:
      case VercelErrorCategory.SERVER:
      case VercelErrorCategory.RATE_LIMIT:
        return true;
      case VercelErrorCategory.AUTH:
      case VercelErrorCategory.VALIDATION:
      case VercelErrorCategory.CONFLICT:
      case VercelErrorCategory.NOT_FOUND:
      case VercelErrorCategory.UNKNOWN:
        return false;
      default:
        return false;
    }
  }

  /**
   * Get user-facing error message
   */
  getUserMessage(): string {
    switch (this.category) {
      case VercelErrorCategory.AUTH:
        return 'Vercel authentication failed — please verify your API token.';
      case VercelErrorCategory.VALIDATION:
        return 'Invalid input — please check your project configuration.';
      case VercelErrorCategory.CONFLICT:
        return 'Resource already exists in Vercel.';
      case VercelErrorCategory.RATE_LIMIT:
        return 'Rate limit exceeded — please try again shortly.';
      case VercelErrorCategory.NOT_FOUND:
        return 'Resource not found in Vercel.';
      case VercelErrorCategory.NETWORK:
        return 'Network error — please check connectivity and try again.';
      case VercelErrorCategory.SERVER:
        return 'Vercel server error — please try again shortly.';
      case VercelErrorCategory.UNKNOWN:
        return 'Unexpected Vercel error — our team has been notified.';
      default:
        return 'An error occurred — please try again.';
    }
  }
}

/**
 * Categorize an error based on HTTP status code
 */
export function categorizeByStatus(statusCode: number): VercelErrorCategory {
  switch (statusCode) {
    case 401:
    case 403:
      return VercelErrorCategory.AUTH;
    case 400:
    case 422:
      return VercelErrorCategory.VALIDATION;
    case 404:
      return VercelErrorCategory.NOT_FOUND;
    case 409:
      return VercelErrorCategory.CONFLICT;
    case 429:
      return VercelErrorCategory.RATE_LIMIT;
    default:
      if (statusCode >= 500) return VercelErrorCategory.SERVER;
      return VercelErrorCategory.UNKNOWN;
  }
}

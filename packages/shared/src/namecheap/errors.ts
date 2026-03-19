/**
 * Namecheap API error handling
 *
 * Error categorization based on Namecheap error codes
 * Reference: docs/namecheap-integration.md Section 6
 */

import type { NamecheapError } from './types.js';

/**
 * Error categories for Namecheap API errors
 */
export enum NamecheapErrorCategory {
  /** Authentication/authorization errors (1010xxx, 1017xxx) */
  AUTH = 'AUTH',

  /** Input validation errors (2011xxx, 2015xxx) */
  VALIDATION = 'VALIDATION',

  /** Payment/billing/order errors (2033xxx, 2528xxx) */
  PAYMENT = 'PAYMENT',

  /** Domain availability errors (3019xxx, 4019xxx) */
  AVAILABILITY = 'AVAILABILITY',

  /** Upstream provider errors (3031xxx, 3050xxx) */
  PROVIDER = 'PROVIDER',

  /** Unknown errors (5019xxx) */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Namecheap API error class
 */
export class NamecheapApiError extends Error {
  public readonly errors: NamecheapError[];
  public readonly category: NamecheapErrorCategory;

  constructor(errors: NamecheapError[], category?: NamecheapErrorCategory) {
    const errorMessages = errors.map(e => `[${e.number}] ${e.message}`).join('; ');
    const detectedCategory = category || categorizeError(errors[0]?.number || '');

    super(`Namecheap API error [${detectedCategory}]: ${errorMessages}`);

    this.name = 'NamecheapApiError';
    this.errors = errors;
    this.category = detectedCategory;

    // Maintain proper stack trace for debugging
    Error.captureStackTrace(this, NamecheapApiError);
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    switch (this.category) {
      case NamecheapErrorCategory.PROVIDER:
        return true;  // Upstream provider errors are retryable
      case NamecheapErrorCategory.AUTH:
      case NamecheapErrorCategory.VALIDATION:
      case NamecheapErrorCategory.PAYMENT:
      case NamecheapErrorCategory.AVAILABILITY:
        return false; // These are terminal errors
      case NamecheapErrorCategory.UNKNOWN:
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
      case NamecheapErrorCategory.AUTH:
        return 'Infrastructure error — our team has been notified.';
      case NamecheapErrorCategory.VALIDATION:
        return 'Invalid input — please check your contact details.';
      case NamecheapErrorCategory.PAYMENT:
        return 'Payment processing error — please try again.';
      case NamecheapErrorCategory.AVAILABILITY:
        return 'Domain is no longer available — it was just registered by someone else.';
      case NamecheapErrorCategory.PROVIDER:
        return 'Waiting on domain registrar — retrying automatically.';
      case NamecheapErrorCategory.UNKNOWN:
        return 'Unexpected error — our team has been notified.';
      default:
        return 'An error occurred — please try again.';
    }
  }
}

/**
 * Categorize an error based on its error code
 *
 * Error code patterns (expanded to cover all codes in ERROR_CODE_MAP):
 * - 10xxxxx: AUTH (1010xxx, 1011xxx, 1016xxx, 1017xxx, 1019xxx, 1030xxx, 1050xxx)
 * - 20xxxxx: VALIDATION (2010xxx, 2011xxx, 2015xxx, 2016xxx, 2019xxx, 2030xxx)
 * - 20xxxxx: PAYMENT (2033xxx, 2528xxx)
 * - 30xxxxx/40xxxxx: AVAILABILITY (3019xxx, 4019xxx)
 * - 30xxxxx: PROVIDER (3011xxx, 3031xxx, 3050xxx, 4022xxx, 4011xxx)
 * - 50xxxxx: UNKNOWN (5019xxx)
 */
export function categorizeError(errorCode: string): NamecheapErrorCategory {
  // AUTH errors (all 10xx codes)
  if (errorCode.match(/^10(10|11|16|17|19|30|50)/)) {
    return NamecheapErrorCategory.AUTH;
  }

  // PAYMENT errors (must check before VALIDATION since both are 2xxx)
  if (errorCode.match(/^(2033|2528)/)) {
    return NamecheapErrorCategory.PAYMENT;
  }

  // VALIDATION errors (expanded to cover all 20xx patterns)
  if (errorCode.match(/^20(10|11|15|16|19|30)/)) {
    return NamecheapErrorCategory.VALIDATION;
  }

  // AVAILABILITY errors
  if (errorCode.match(/^[34]019/)) {
    return NamecheapErrorCategory.AVAILABILITY;
  }

  // PROVIDER errors (expanded to include 3011xxx and 40xx patterns)
  if (errorCode.match(/^(30(11|31|50)|40(11|22))/)) {
    return NamecheapErrorCategory.PROVIDER;
  }

  // UNKNOWN errors
  if (errorCode.match(/^5019/)) {
    return NamecheapErrorCategory.UNKNOWN;
  }

  // Default to UNKNOWN for unrecognized patterns
  return NamecheapErrorCategory.UNKNOWN;
}

/**
 * Map of specific error codes to human-readable descriptions
 */
export const ERROR_CODE_MAP: Record<string, string> = {
  // Global errors (Section 2.3 of spec)
  '1010101': 'APIUser parameter missing',
  '1010102': 'APIKey parameter missing',
  '1011102': 'APIKey parameter missing',
  '1010104': 'Command parameter missing',
  '1010105': 'ClientIP parameter missing',
  '1011105': 'ClientIP parameter missing',
  '1030408': 'Unsupported authentication type',
  '1050900': 'Unknown error validating APIUser',
  '1011150': 'RequestIP is invalid',
  '1017150': 'RequestIP disabled or locked',
  '1017105': 'ClientIP disabled or locked',
  '1017101': 'ApiUser disabled or locked',
  '1017410': 'Too many declined payments',
  '1017411': 'Too many login attempts',
  '1019103': 'UserName not available',
  '1016103': 'UserName unauthorized',
  '1017103': 'UserName disabled or locked',

  // Domain check errors (Section 3.1)
  '2011169': 'Only 50 domains allowed per check call',
  '3031510': 'Error response from upstream provider',
  '3011511': 'Unknown response from upstream provider',

  // Domain create errors (Section 3.3)
  '2033409': 'Auth/order error — order not found for username',
  '2033407': 'WHOIS privacy conflict',
  '2033270': 'WHOIS privacy conflict',
  '2015182': 'Phone format invalid — must be +NNN.NNNNNNNNNN',
  '2011170': 'Invalid promotion code',
  '2011280': 'TLD not supported',
  '2030280': 'TLD not supported in API',
  '2015167': 'Invalid years parameter',
  '2011168': 'Nameservers invalid',
  '2011322': 'Extended attributes invalid',
  '2010323': 'Missing billing contact fields',
  '2528166': 'Order creation failed',
  '3019166': 'Domain not available',
  '4019166': 'Domain not available',
  '3031166': 'Error from upstream provider',
  '3031900': 'Unknown upstream response',

  // Domain DNS errors (Section 3.4)
  '2019166': 'Domain not found',
  '2016166': 'Domain not associated with your account',
  '2030166': 'Edit permission not supported or invalid domain',
  '3050900': 'Unknown upstream error',
  '4022288': 'Unable to get nameserver list',

  // Domain info errors (Section 3.5)
  '5019169': 'Unknown exception',
  '4011103': 'Domain/user not available or access denied',

  // Balance errors (Section 3.7)
  '4022312': 'Balance info not available',
};

/**
 * @forj/shared/namecheap - Namecheap API client
 *
 * TypeScript client for Namecheap Reseller API
 * Reference: docs/namecheap-integration.md
 */

// Types
export type {
  NamecheapConfig,
  NamecheapApiResponse,
  ContactInfo,
  DomainCheckResult,
  TldPricing,
  DomainCreateParams,
  DomainCreateResult,
  DomainInfo,
  DomainRenewParams,
  DomainRenewResult,
  AccountBalances,
  DomainListParams,
  DomainListItem,
  DomainListResult,
  NamecheapError,
} from './types.js';

// Errors
export {
  NamecheapApiError,
  NamecheapErrorCategory,
  categorizeError,
  ERROR_CODE_MAP,
} from './errors.js';

// XML Parser utilities
export {
  parseResponse,
  normalizeArray,
  parseBoolean,
  parseNumber,
  getAttribute,
} from './xml-parser.js';

// Client
export { NamecheapClient } from './client.js';

// Constants
export { NAMECHEAP_URLS, REQUEST_TIMEOUT_MS, USER_AGENT } from './constants.js';

// Utilities
export { flattenContactInfo, splitDomain, formatPhoneNumber } from './utils.js';

// Rate Limiter
export {
  RateLimiter,
  createNamecheapRateLimiter,
  type RateLimiterConfig,
  type RateLimiterLogger,
  type RateLimitResult,
} from './rate-limiter.js';

// Request Queue
export {
  NamecheapRequestQueue,
  RequestPriority,
  type RequestExecutor,
  type QueuePosition,
} from './request-queue.js';

// Queue Events
export {
  QueueEventEmitter,
  QueueEventType,
  type QueueEvent,
  type EnqueuedEvent,
  type ProcessingEvent,
  type CompletedEvent,
  type FailedEvent,
  type PositionUpdateEvent,
  type MetricsUpdateEvent,
  type QueueEventData,
} from './queue-events.js';

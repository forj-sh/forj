/**
 * @forj/shared - Shared types and utilities for Forj monorepo
 */

// API response types
export type { ApiResponse, PaginatedResponse } from './api.js';

// Authentication types
export type { CLIAuthRequest, CLIAuthResponse, TokenPayload } from './auth.js';

// Domain types
export type { DomainOption, DomainCheckRequest, DomainCheckResponse } from './domains.js';

// DNS types
export type {
  DNSRecordType,
  DNSRecordStatus,
  DNSHealthStatus,
  DNSRecord,
  DNSHealthResult,
  DNSFixRequest,
  DNSFixResponse,
} from './dns.js';

// Service types
export type {
  ServiceStatus,
  ServiceDisplayStatus,
  ServiceType,
  ServiceState,
  ServiceStatusDisplay,
} from './services.js';

// Project types
export type { Project, ProjectConfig, ProjectStatus } from './project.js';

// Project API types
export type {
  ProjectInitRequest,
  ProjectInitResponse,
  AddServiceRequest,
  AddServiceResponse,
} from './projects.js';

// SSE event types
export type {
  SSEEvent,
  ServiceEvent,
  CompleteEvent,
  ErrorEvent,
  ProvisioningEvent,
} from './events.js';

// Namecheap API types and utilities
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
} from './namecheap/index.js';

export {
  NamecheapApiError,
  NamecheapErrorCategory,
  categorizeError,
  ERROR_CODE_MAP,
  NamecheapClient,
  NAMECHEAP_URLS,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  flattenContactInfo,
  splitDomain,
  formatPhoneNumber,
  RateLimiter,
  createNamecheapRateLimiter,
  type RateLimiterConfig,
  type RateLimiterLogger,
  type RateLimitResult,
  NamecheapRequestQueue,
  RequestPriority,
  type RequestExecutor,
  type QueuePosition,
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
} from './namecheap/index.js';

// Domain worker types
export type {
  BaseDomainJobData,
  CheckDomainJobData,
  RegisterDomainJobData,
  RenewDomainJobData,
  SetNameserversJobData,
  GetDomainInfoJobData,
  DomainJobData,
  DomainWorkerConfig,
  DomainWorkerEvent,
  IWorkerEventPublisher,
} from './domain-worker.js';

export {
  DomainOperationType,
  DomainJobStatus,
  DomainWorkerEventType,
  DOMAIN_STATE_TRANSITIONS,
  isValidStateTransition,
  isTerminalState,
  isRetryableState,
} from './domain-worker.js';

// Stripe payment types
export type {
  StripeCheckoutMetadata,
  ParsedCheckoutMetadata,
  DomainPaymentData,
  StripeWebhookPayload,
  StripeConfig,
  DomainCheckoutPricing,
} from './stripe.js';

export {
  StripeWebhookEvent,
  parseCheckoutMetadata,
  calculateDomainPricing,
  dollarsToCents,
  centsToDollars,
} from './stripe.js';

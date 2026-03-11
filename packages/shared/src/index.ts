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

// GitHub worker types
export type {
  BaseGitHubJobData,
  VerifyOrgJobData,
  CreateRepoJobData,
  ConfigureRepoJobData,
  GitHubJobData,
  GitHubWorkerConfig,
  GitHubWorkerEvent,
  IGitHubWorkerEventPublisher,
} from './github-worker.js';

export {
  GitHubOperationType,
  GitHubJobStatus,
  GitHubWorkerEventType,
  GITHUB_STATE_TRANSITIONS,
  isValidStateTransition as isValidGitHubStateTransition,
  isTerminalState as isGitHubTerminalState,
  isRetryableState as isGitHubRetryableState,
} from './github-worker.js';

// Cloudflare worker types
export type {
  BaseCloudflareJobData,
  CreateZoneJobData,
  UpdateNameserversJobData,
  VerifyNameserversJobData,
  CloudflareJobData,
  CloudflareWorkerConfig,
  CloudflareWorkerEvent,
  ICloudflareWorkerEventPublisher,
} from './cloudflare-worker.js';

export {
  CloudflareOperationType,
  CloudflareJobStatus,
  CloudflareWorkerEventType,
  CLOUDFLARE_STATE_TRANSITIONS,
  isValidStateTransition as isValidCloudflareStateTransition,
  isTerminalState as isCloudflareTerminalState,
  isRetryableState as isCloudflareRetryableState,
} from './cloudflare-worker.js';

// DNS worker types
export type {
  BaseDNSJobData,
  WireDNSRecordsJobData,
  VerifyDNSRecordsJobData,
  DNSJobData,
  DNSWorkerConfig,
  DNSWorkerEvent,
  IWorkerEventPublisher as IDNSWorkerEventPublisher,
} from './dns-worker.js';

export {
  DNSOperationType,
  DNSJobStatus,
  EmailProvider,
  DNSWorkerEventType,
  DNS_STATE_TRANSITIONS,
  isValidStateTransition as isValidDNSStateTransition,
  isTerminalState as isDNSTerminalState,
  isRetryableState as isDNSRetryableState,
  DEFAULT_MX_RECORDS,
  DEFAULT_SPF_RECORDS,
  DEFAULT_DMARC_RECORD,
} from './dns-worker.js';

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

// Cloudflare API types and utilities
export type {
  CloudflareConfig,
  CloudflareApiResponse,
  CloudflareResultInfo,
  CloudflareApiErrorType,
  CloudflareZone,
  ZoneStatus,
  ZoneType,
  DNSRecordType as CloudflareDNSRecordType,
  DNSRecord as CloudflareDNSRecord,
  DNSRecordInput,
  ZoneCreateParams,
  TokenVerification,
  TokenPolicy,
  PermissionGroup,
  TokenCondition,
  CloudflareAccount,
} from './cloudflare/index.js';

export {
  CloudflareApiError,
  CloudflareErrorCategory,
  categorizeError as categorizeCloudflareError,
  ERROR_CODE_MAP as CLOUDFLARE_ERROR_CODE_MAP,
  CloudflareClient,
  CLOUDFLARE_API_URL,
  REQUEST_TIMEOUT_MS as CLOUDFLARE_REQUEST_TIMEOUT_MS,
  USER_AGENT as CLOUDFLARE_USER_AGENT,
  RATE_LIMITS as CLOUDFLARE_RATE_LIMITS,
  DEFAULT_DNS_TTL,
  CLOUDFLARE_NS_PATTERN,
} from './cloudflare/index.js';

// GitHub API types and utilities
export type {
  GitHubConfig,
  GitHubOrg,
  GitHubRepo,
  RepoCreateParams,
  BranchProtectionParams,
  FileContent,
  GitHubPagesConfig,
  GitHubAuthenticatedUser,
} from './github/index.js';

export {
  GitHubClient,
  GitHubError,
  GitHubErrorCategory,
  categorizeErrorByStatus as categorizeGitHubError,
  createErrorFromResponse as createGitHubErrorFromResponse,
  createNetworkError as createGitHubNetworkError,
  GITHUB_API_BASE_URL,
  GITHUB_OAUTH,
  GITHUB_RATE_LIMITS,
  GITHUB_SCOPES,
  FORJ_GITHUB_SCOPES,
  REPO_VISIBILITY,
  GITIGNORE_TEMPLATES,
  LICENSE_TEMPLATES,
  PAGES_PATHS,
  DEFAULT_BRANCH_PROTECTION,
  FORJ_USER_AGENT as GITHUB_USER_AGENT,
} from './github/index.js';

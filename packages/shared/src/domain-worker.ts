/**
 * Domain worker types and state machine
 *
 * Reference: project-docs/namecheap-integration-spec.md Section 5
 *
 * Defines job types, state machine, and worker configuration for
 * domain operations (check, register, configure DNS).
 */

import type { ContactInfo } from './namecheap/index.js';

/**
 * Domain operation types
 */
export enum DomainOperationType {
  CHECK = 'check',               // Check domain availability
  REGISTER = 'register',         // Register a domain
  RENEW = 'renew',              // Renew a domain
  SET_NAMESERVERS = 'set_nameservers', // Configure custom nameservers
  GET_INFO = 'get_info',        // Get domain information
}

/**
 * Domain job status (state machine)
 */
export enum DomainJobStatus {
  PENDING = 'pending',           // Job created, not started
  QUEUED = 'queued',            // Added to priority queue
  CHECKING = 'checking',        // Checking availability (for register flow)
  AVAILABLE = 'available',      // Domain is available
  UNAVAILABLE = 'unavailable',  // Domain is not available
  REGISTERING = 'registering',  // Registering domain with Namecheap
  CONFIGURING = 'configuring',  // Setting nameservers
  COMPLETE = 'complete',        // Operation succeeded
  FAILED = 'failed',            // Operation failed
  RETRYING = 'retrying',        // Retrying after failure
}

/**
 * Base domain job data
 */
export interface BaseDomainJobData {
  /** Job ID (BullMQ job ID) */
  jobId: string;
  /** User ID for request tracking */
  userId?: string;
  /** Project ID */
  projectId: string;
  /** Operation type */
  operation: DomainOperationType;
  /** Current status */
  status: DomainJobStatus;
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  /** Number of retry attempts */
  attempts: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Check domain availability job
 */
export interface CheckDomainJobData extends BaseDomainJobData {
  operation: DomainOperationType.CHECK;
  /** Domains to check */
  domains: string[];
  /** Check results (populated after completion) */
  results?: Array<{
    domain: string;
    available: boolean;
    isPremium: boolean;
    premiumRegistrationPrice: number;
    premiumRenewalPrice: number;
    icannFee: number;
  }>;
}

/**
 * Register domain job
 */
export interface RegisterDomainJobData extends BaseDomainJobData {
  operation: DomainOperationType.REGISTER;
  /** Domain to register */
  domainName: string;
  /** Registration duration in years */
  years: number;
  /** Contact information */
  registrant: ContactInfo;
  tech: ContactInfo;
  admin: ContactInfo;
  auxBilling: ContactInfo;
  /** Nameservers to configure */
  nameservers?: string[];
  /** WhoisGuard settings */
  addFreeWhoisguard: boolean;
  wgEnabled: boolean;
  /** Premium domain handling */
  isPremiumDomain: boolean;
  premiumPrice?: number;
  /** Promotion code */
  promotionCode?: string;
  /** Registration result (populated after completion) */
  result?: {
    domain: string;
    registered: boolean;
    chargedAmount: number;
    domainId: number;
    orderId: number;
    transactionId: number;
    whoisguardEnabled: boolean;
  };
}

/**
 * Renew domain job
 */
export interface RenewDomainJobData extends BaseDomainJobData {
  operation: DomainOperationType.RENEW;
  /** Domain to renew */
  domainName: string;
  /** Renewal duration in years */
  years: number;
  /** Premium domain handling */
  isPremiumDomain: boolean;
  premiumPrice?: number;
  /** Promotion code */
  promotionCode?: string;
  /** Renewal result (populated after completion) */
  result?: {
    domainName: string;
    domainId: number;
    renewed: boolean;
    chargedAmount: number;
    orderId: number;
    transactionId: number;
  };
}

/**
 * Set nameservers job
 */
export interface SetNameserversJobData extends BaseDomainJobData {
  operation: DomainOperationType.SET_NAMESERVERS;
  /** Domain to configure */
  domainName: string;
  /** Nameservers to set */
  nameservers: string[];
  /** Update result */
  result?: {
    updated: boolean;
  };
}

/**
 * Get domain info job
 */
export interface GetDomainInfoJobData extends BaseDomainJobData {
  operation: DomainOperationType.GET_INFO;
  /** Domain to query */
  domainName: string;
  /** Domain info result */
  result?: {
    status: 'OK' | 'Locked' | 'Expired';
    id: number;
    domainName: string;
    ownerName: string;
    isOwner: boolean;
    isPremium: boolean;
  };
}

/**
 * Union type of all domain job data
 */
export type DomainJobData =
  | CheckDomainJobData
  | RegisterDomainJobData
  | RenewDomainJobData
  | SetNameserversJobData
  | GetDomainInfoJobData;

/**
 * State machine transitions
 *
 * Defines valid state transitions for domain jobs
 */
export const DOMAIN_STATE_TRANSITIONS: Record<DomainJobStatus, DomainJobStatus[]> = {
  [DomainJobStatus.PENDING]: [DomainJobStatus.QUEUED, DomainJobStatus.FAILED],
  [DomainJobStatus.QUEUED]: [
    DomainJobStatus.CHECKING,
    DomainJobStatus.REGISTERING,
    DomainJobStatus.CONFIGURING,
    DomainJobStatus.COMPLETE,
    DomainJobStatus.FAILED,
  ],
  [DomainJobStatus.CHECKING]: [
    DomainJobStatus.AVAILABLE,
    DomainJobStatus.UNAVAILABLE,
    DomainJobStatus.COMPLETE,
    DomainJobStatus.FAILED,
    DomainJobStatus.RETRYING,
  ],
  [DomainJobStatus.AVAILABLE]: [
    DomainJobStatus.REGISTERING,
    DomainJobStatus.FAILED,
  ],
  [DomainJobStatus.UNAVAILABLE]: [], // Terminal state - domain taken
  [DomainJobStatus.REGISTERING]: [
    DomainJobStatus.CONFIGURING,
    DomainJobStatus.COMPLETE,
    DomainJobStatus.FAILED,
    DomainJobStatus.RETRYING,
  ],
  [DomainJobStatus.CONFIGURING]: [
    DomainJobStatus.COMPLETE,
    DomainJobStatus.FAILED,
    DomainJobStatus.RETRYING,
  ],
  [DomainJobStatus.COMPLETE]: [], // Terminal state
  [DomainJobStatus.FAILED]: [DomainJobStatus.RETRYING], // Can retry
  [DomainJobStatus.RETRYING]: [
    DomainJobStatus.QUEUED,
    DomainJobStatus.CHECKING,
    DomainJobStatus.REGISTERING,
    DomainJobStatus.CONFIGURING,
    DomainJobStatus.FAILED,
  ],
};

/**
 * Validate state transition
 *
 * @param from - Current state
 * @param to - Target state
 * @returns True if transition is valid
 */
export function isValidStateTransition(from: DomainJobStatus, to: DomainJobStatus): boolean {
  const allowedTransitions = DOMAIN_STATE_TRANSITIONS[from];
  return allowedTransitions.includes(to);
}

/**
 * Check if state is terminal
 *
 * A state is terminal if it has no valid transitions (derived from state machine).
 * Terminal states: COMPLETE, UNAVAILABLE
 * Note: FAILED is NOT terminal because it can transition to RETRYING.
 *
 * @param status - Job status
 * @returns True if status is terminal (no further transitions)
 */
export function isTerminalState(status: DomainJobStatus): boolean {
  const allowedTransitions = DOMAIN_STATE_TRANSITIONS[status];
  return !allowedTransitions || allowedTransitions.length === 0;
}

/**
 * Check if state is retryable
 *
 * A state is retryable if it can transition to RETRYING state.
 * Based on DOMAIN_STATE_TRANSITIONS, these states can retry:
 * - FAILED: Explicit failure that can be retried
 * - CHECKING: API failure during availability check
 * - REGISTERING: API failure during registration
 * - CONFIGURING: API failure during nameserver configuration
 *
 * @param status - Job status
 * @returns True if status allows retry
 */
export function isRetryableState(status: DomainJobStatus): boolean {
  return (
    status === DomainJobStatus.FAILED ||
    status === DomainJobStatus.CHECKING ||
    status === DomainJobStatus.REGISTERING ||
    status === DomainJobStatus.CONFIGURING
  );
}

/**
 * Minimal interface for Redis pub/sub client
 *
 * The worker uses this to publish events without depending on
 * the full RedisPubSub implementation from @forj/api.
 */
export interface IWorkerEventPublisher {
  /**
   * Publish a worker event to a project channel
   * @param projectId - Project ID to publish to
   * @param event - Domain worker event to publish
   * @returns Number of subscribers that received the message, or null if publish failed
   */
  publishWorkerEvent(
    projectId: string,
    event: DomainWorkerEvent
  ): Promise<number | null>;
}

/**
 * Domain worker configuration
 */
export interface DomainWorkerConfig {
  /** Namecheap API configuration */
  namecheap: {
    apiUser: string;
    apiKey: string;
    userName: string;
    clientIp: string;
    sandbox: boolean;
  };
  /** Redis connection */
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  /** BullMQ queue configuration */
  queue: {
    name: string;
    /** Max concurrent jobs */
    concurrency: number;
    /** Job retry settings */
    retry: {
      maxAttempts: number;
      backoffType: 'fixed' | 'exponential';
      backoffDelay: number;
    };
  };
  /** Optional Redis pub/sub for real-time event streaming */
  eventPublisher?: IWorkerEventPublisher;
}

/**
 * Domain worker event types for SSE streaming
 */
export enum DomainWorkerEventType {
  JOB_CREATED = 'job_created',
  JOB_QUEUED = 'job_queued',
  JOB_STARTED = 'job_started',
  JOB_PROGRESS = 'job_progress',
  JOB_COMPLETED = 'job_completed',
  JOB_FAILED = 'job_failed',
  JOB_RETRYING = 'job_retrying',
}

/**
 * Domain worker event
 */
export interface DomainWorkerEvent {
  type: DomainWorkerEventType;
  jobId: string;
  projectId: string;
  operation: DomainOperationType;
  status: DomainJobStatus;
  timestamp: number;
  /** Event-specific data payload. Use type guards to narrow before accessing. */
  data?: unknown;
  error?: string;
}

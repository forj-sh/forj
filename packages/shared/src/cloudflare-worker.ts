/**
 * Cloudflare worker types and state machine
 *
 * Defines job data, states, and transitions for Cloudflare zone provisioning operations.
 */

/**
 * Cloudflare operation types
 */
export enum CloudflareOperationType {
  CREATE_ZONE = 'CREATE_ZONE',
  UPDATE_NAMESERVERS = 'UPDATE_NAMESERVERS',
  VERIFY_NAMESERVERS = 'VERIFY_NAMESERVERS',
}

/**
 * Cloudflare job status (matches state machine)
 */
export enum CloudflareJobStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  CREATING_ZONE = 'creating_zone',
  ZONE_CREATED = 'zone_created',
  UPDATING_NAMESERVERS = 'updating_nameservers',
  NAMESERVERS_UPDATED = 'nameservers_updated',
  VERIFYING_NAMESERVERS = 'verifying_nameservers',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * Base job data for all Cloudflare operations
 */
export interface BaseCloudflareJobData {
  userId: string;
  projectId: string;
  domain: string;
  apiToken: string;
  accountId?: string;
}

/**
 * Create zone job data
 */
export interface CreateZoneJobData extends BaseCloudflareJobData {
  operation: CloudflareOperationType.CREATE_ZONE;
}

/**
 * Update nameservers job data
 */
export interface UpdateNameserversJobData extends BaseCloudflareJobData {
  operation: CloudflareOperationType.UPDATE_NAMESERVERS;
  zoneId: string;
  nameservers: string[];
  namecheapAccessToken?: string; // For Namecheap API if domain is registered there
}

/**
 * Verify nameservers job data
 */
export interface VerifyNameserversJobData extends BaseCloudflareJobData {
  operation: CloudflareOperationType.VERIFY_NAMESERVERS;
  zoneId: string;
  expectedNameservers: string[];
}

/**
 * Union type for all Cloudflare job data
 */
export type CloudflareJobData =
  | CreateZoneJobData
  | UpdateNameserversJobData
  | VerifyNameserversJobData;

/**
 * Cloudflare worker configuration
 */
export interface CloudflareWorkerConfig {
  redis: {
    host: string;
    port: number;
  };
  concurrency?: number;
  eventPublisher?: ICloudflareWorkerEventPublisher;
}

/**
 * Cloudflare worker event types
 */
export enum CloudflareWorkerEventType {
  ZONE_CREATION_STARTED = 'cloudflare.zone.creation.started',
  ZONE_CREATION_COMPLETE = 'cloudflare.zone.creation.complete',
  ZONE_CREATION_FAILED = 'cloudflare.zone.creation.failed',
  NAMESERVER_UPDATE_STARTED = 'cloudflare.nameserver.update.started',
  NAMESERVER_UPDATE_COMPLETE = 'cloudflare.nameserver.update.complete',
  NAMESERVER_UPDATE_FAILED = 'cloudflare.nameserver.update.failed',
  NAMESERVER_VERIFICATION_STARTED = 'cloudflare.nameserver.verification.started',
  NAMESERVER_VERIFICATION_COMPLETE = 'cloudflare.nameserver.verification.complete',
  NAMESERVER_VERIFICATION_FAILED = 'cloudflare.nameserver.verification.failed',
}

/**
 * Cloudflare worker event
 */
export interface CloudflareWorkerEvent {
  type: CloudflareWorkerEventType;
  projectId: string;
  userId: string;
  jobId: string;
  timestamp: string;
  data: {
    domain?: string;
    zoneId?: string;
    nameservers?: string[];
    error?: string;
    status?: CloudflareJobStatus;
    [key: string]: unknown;
  };
}

/**
 * Worker event publisher interface
 */
export interface ICloudflareWorkerEventPublisher {
  publishEvent(event: CloudflareWorkerEvent): Promise<void>;
}

/**
 * Cloudflare state machine transitions
 *
 * Defines valid state transitions for Cloudflare operations.
 */
export const CLOUDFLARE_STATE_TRANSITIONS: Record<CloudflareJobStatus, CloudflareJobStatus[]> = {
  [CloudflareJobStatus.PENDING]: [CloudflareJobStatus.QUEUED, CloudflareJobStatus.FAILED],
  [CloudflareJobStatus.QUEUED]: [CloudflareJobStatus.CREATING_ZONE, CloudflareJobStatus.FAILED],
  [CloudflareJobStatus.CREATING_ZONE]: [CloudflareJobStatus.ZONE_CREATED, CloudflareJobStatus.FAILED],
  [CloudflareJobStatus.ZONE_CREATED]: [
    CloudflareJobStatus.UPDATING_NAMESERVERS,
    CloudflareJobStatus.COMPLETE,
    CloudflareJobStatus.FAILED,
  ],
  [CloudflareJobStatus.UPDATING_NAMESERVERS]: [
    CloudflareJobStatus.NAMESERVERS_UPDATED,
    CloudflareJobStatus.FAILED,
  ],
  [CloudflareJobStatus.NAMESERVERS_UPDATED]: [
    CloudflareJobStatus.VERIFYING_NAMESERVERS,
    CloudflareJobStatus.COMPLETE,
    CloudflareJobStatus.FAILED,
  ],
  [CloudflareJobStatus.VERIFYING_NAMESERVERS]: [CloudflareJobStatus.COMPLETE, CloudflareJobStatus.FAILED],
  [CloudflareJobStatus.COMPLETE]: [],
  [CloudflareJobStatus.FAILED]: [],
};

/**
 * Check if state transition is valid
 */
export function isValidStateTransition(
  currentState: CloudflareJobStatus,
  nextState: CloudflareJobStatus
): boolean {
  const validTransitions = CLOUDFLARE_STATE_TRANSITIONS[currentState];
  return validTransitions.includes(nextState);
}

/**
 * Check if state is terminal (no further transitions)
 */
export function isTerminalState(state: CloudflareJobStatus): boolean {
  return state === CloudflareJobStatus.COMPLETE || state === CloudflareJobStatus.FAILED;
}

/**
 * Check if state is retryable
 */
export function isRetryableState(state: CloudflareJobStatus): boolean {
  // Only failed states are retryable
  return state === CloudflareJobStatus.FAILED;
}

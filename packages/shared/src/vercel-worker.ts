/**
 * Vercel worker types and state machine
 *
 * Defines job data, states, and transitions for Vercel project provisioning.
 */

/**
 * Vercel operation types
 */
export enum VercelOperationType {
  VERIFY_TEAM = 'VERIFY_TEAM',
  CREATE_PROJECT = 'CREATE_PROJECT',
  CONFIGURE_DOMAIN = 'CONFIGURE_DOMAIN',
}

/**
 * Vercel job status (matches state machine)
 */
export enum VercelJobStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  VERIFYING_TEAM = 'verifying_team',
  TEAM_VERIFIED = 'team_verified',
  CREATING_PROJECT = 'creating_project',
  PROJECT_CREATED = 'project_created',
  CONFIGURING_DOMAIN = 'configuring_domain',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * Base job data for all Vercel operations
 *
 * SECURITY: Credentials are NOT stored in Redis job data.
 * Workers fetch encrypted credentials from database using userId.
 */
export interface BaseVercelJobData {
  userId: string;
  projectId: string;
  domain: string;
}

/**
 * Verify team job data
 */
export interface VerifyTeamJobData extends BaseVercelJobData {
  operation: VercelOperationType.VERIFY_TEAM;
  teamId?: string;
}

/**
 * Create project job data
 */
export interface CreateProjectJobData extends BaseVercelJobData {
  operation: VercelOperationType.CREATE_PROJECT;
  teamId?: string;
  githubOrg: string;
  repoName: string;
}

/**
 * Configure domain job data
 */
export interface ConfigureDomainJobData extends BaseVercelJobData {
  operation: VercelOperationType.CONFIGURE_DOMAIN;
  teamId?: string;
  vercelProjectId: string;
  cloudflareZoneId?: string;
}

/**
 * Union type for all Vercel job data
 */
export type VercelJobData =
  | VerifyTeamJobData
  | CreateProjectJobData
  | ConfigureDomainJobData;

/**
 * Vercel worker configuration
 */
export interface VercelWorkerConfig {
  redis: {
    host: string;
    port: number;
  };
  concurrency?: number;
  eventPublisher?: IVercelWorkerEventPublisher;
}

/**
 * Vercel worker event types
 */
export enum VercelWorkerEventType {
  TEAM_VERIFICATION_STARTED = 'vercel.team.verification.started',
  TEAM_VERIFICATION_COMPLETE = 'vercel.team.verification.complete',
  TEAM_VERIFICATION_FAILED = 'vercel.team.verification.failed',
  PROJECT_CREATION_STARTED = 'vercel.project.creation.started',
  PROJECT_CREATION_COMPLETE = 'vercel.project.creation.complete',
  PROJECT_CREATION_FAILED = 'vercel.project.creation.failed',
  DOMAIN_CONFIGURATION_STARTED = 'vercel.domain.configuration.started',
  DOMAIN_CONFIGURATION_COMPLETE = 'vercel.domain.configuration.complete',
  DOMAIN_CONFIGURATION_FAILED = 'vercel.domain.configuration.failed',
}

/**
 * Vercel worker event
 */
export interface VercelWorkerEvent {
  type: VercelWorkerEventType;
  projectId: string;
  userId: string;
  jobId: string;
  timestamp: string;
  data: {
    domain?: string;
    teamId?: string;
    vercelProjectId?: string;
    error?: string;
    status?: VercelJobStatus;
    [key: string]: unknown;
  };
}

/**
 * Worker event publisher interface
 */
export interface IVercelWorkerEventPublisher {
  publishEvent(event: VercelWorkerEvent): Promise<void>;
}

/**
 * Vercel state machine transitions
 *
 * Defines valid state transitions for Vercel operations.
 */
export const VERCEL_STATE_TRANSITIONS: Record<VercelJobStatus, VercelJobStatus[]> = {
  [VercelJobStatus.PENDING]: [VercelJobStatus.QUEUED, VercelJobStatus.FAILED],
  [VercelJobStatus.QUEUED]: [VercelJobStatus.VERIFYING_TEAM, VercelJobStatus.FAILED],
  [VercelJobStatus.VERIFYING_TEAM]: [VercelJobStatus.TEAM_VERIFIED, VercelJobStatus.FAILED],
  [VercelJobStatus.TEAM_VERIFIED]: [VercelJobStatus.CREATING_PROJECT, VercelJobStatus.FAILED],
  [VercelJobStatus.CREATING_PROJECT]: [VercelJobStatus.PROJECT_CREATED, VercelJobStatus.FAILED],
  [VercelJobStatus.PROJECT_CREATED]: [
    VercelJobStatus.CONFIGURING_DOMAIN,
    VercelJobStatus.COMPLETE,
    VercelJobStatus.FAILED,
  ],
  [VercelJobStatus.CONFIGURING_DOMAIN]: [VercelJobStatus.COMPLETE, VercelJobStatus.FAILED],
  [VercelJobStatus.COMPLETE]: [],
  [VercelJobStatus.FAILED]: [],
};

/**
 * Check if state transition is valid
 */
export function isValidVercelStateTransition(
  currentState: VercelJobStatus,
  nextState: VercelJobStatus
): boolean {
  const validTransitions = VERCEL_STATE_TRANSITIONS[currentState];
  return validTransitions.includes(nextState);
}

/**
 * Check if state is terminal (no further transitions)
 */
export function isVercelTerminalState(state: VercelJobStatus): boolean {
  return state === VercelJobStatus.COMPLETE || state === VercelJobStatus.FAILED;
}

/**
 * Check if state is retryable
 */
export function isVercelRetryableState(state: VercelJobStatus): boolean {
  return state === VercelJobStatus.FAILED;
}

/**
 * GitHub worker types and state machine
 *
 * Defines job data, states, and transitions for GitHub repository provisioning operations.
 */

/**
 * GitHub operation types
 */
export enum GitHubOperationType {
  VERIFY_ORG = 'VERIFY_ORG',
  CREATE_REPO = 'CREATE_REPO',
  CONFIGURE_REPO = 'CONFIGURE_REPO',
}

/**
 * GitHub job status (matches state machine)
 */
export enum GitHubJobStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  VERIFYING_ORG = 'verifying_org',
  ORG_VERIFIED = 'org_verified',
  CREATING_REPO = 'creating_repo',
  REPO_CREATED = 'repo_created',
  CONFIGURING = 'configuring',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * Base job data for all GitHub operations
 */
export interface BaseGitHubJobData {
  userId: string;
  projectId: string;
  orgName: string;
  accessToken: string;
}

/**
 * Verify organization job data
 */
export interface VerifyOrgJobData extends BaseGitHubJobData {
  operation: GitHubOperationType.VERIFY_ORG;
}

/**
 * Create repository job data
 */
export interface CreateRepoJobData extends BaseGitHubJobData {
  operation: GitHubOperationType.CREATE_REPO;
  repoName: string;
  repoDescription?: string;
  isPrivate?: boolean;
  autoInit?: boolean;
  gitignoreTemplate?: string;
  licenseTemplate?: string;
}

/**
 * Configure repository job data (branch protection, Pages, etc.)
 */
export interface ConfigureRepoJobData extends BaseGitHubJobData {
  operation: GitHubOperationType.CONFIGURE_REPO;
  repoName: string;
  enableBranchProtection?: boolean;
  enablePages?: boolean;
  pagesBranch?: string;
  pagesPath?: '/' | '/docs';
  customDomain?: string;
  topics?: string[];
}

/**
 * Union type for all GitHub job data
 */
export type GitHubJobData = VerifyOrgJobData | CreateRepoJobData | ConfigureRepoJobData;

/**
 * GitHub worker configuration
 */
export interface GitHubWorkerConfig {
  redis: {
    host: string;
    port: number;
  };
  concurrency?: number;
  eventPublisher?: IGitHubWorkerEventPublisher;
}

/**
 * GitHub worker event types
 */
export enum GitHubWorkerEventType {
  ORG_VERIFICATION_STARTED = 'github.org.verification.started',
  ORG_VERIFICATION_COMPLETE = 'github.org.verification.complete',
  ORG_VERIFICATION_FAILED = 'github.org.verification.failed',
  REPO_CREATION_STARTED = 'github.repo.creation.started',
  REPO_CREATION_COMPLETE = 'github.repo.creation.complete',
  REPO_CREATION_FAILED = 'github.repo.creation.failed',
  REPO_CONFIGURATION_STARTED = 'github.repo.configuration.started',
  REPO_CONFIGURATION_COMPLETE = 'github.repo.configuration.complete',
  REPO_CONFIGURATION_FAILED = 'github.repo.configuration.failed',
}

/**
 * GitHub worker event
 */
export interface GitHubWorkerEvent {
  type: GitHubWorkerEventType;
  projectId: string;
  userId: string;
  jobId: string;
  timestamp: string;
  data: {
    orgName?: string;
    repoName?: string;
    repoUrl?: string;
    error?: string;
    status?: GitHubJobStatus;
    [key: string]: unknown;
  };
}

/**
 * Worker event publisher interface
 */
export interface IGitHubWorkerEventPublisher {
  publishEvent(event: GitHubWorkerEvent): Promise<void>;
}

/**
 * GitHub state machine transitions
 *
 * Defines valid state transitions for GitHub operations.
 */
export const GITHUB_STATE_TRANSITIONS: Record<GitHubJobStatus, GitHubJobStatus[]> = {
  [GitHubJobStatus.PENDING]: [GitHubJobStatus.QUEUED, GitHubJobStatus.FAILED],
  [GitHubJobStatus.QUEUED]: [GitHubJobStatus.VERIFYING_ORG, GitHubJobStatus.FAILED],
  [GitHubJobStatus.VERIFYING_ORG]: [GitHubJobStatus.ORG_VERIFIED, GitHubJobStatus.FAILED],
  [GitHubJobStatus.ORG_VERIFIED]: [GitHubJobStatus.CREATING_REPO, GitHubJobStatus.COMPLETE, GitHubJobStatus.FAILED],
  [GitHubJobStatus.CREATING_REPO]: [GitHubJobStatus.REPO_CREATED, GitHubJobStatus.FAILED],
  [GitHubJobStatus.REPO_CREATED]: [GitHubJobStatus.CONFIGURING, GitHubJobStatus.COMPLETE, GitHubJobStatus.FAILED],
  [GitHubJobStatus.CONFIGURING]: [GitHubJobStatus.COMPLETE, GitHubJobStatus.FAILED],
  [GitHubJobStatus.COMPLETE]: [],
  [GitHubJobStatus.FAILED]: [],
};

/**
 * Check if state transition is valid
 */
export function isValidStateTransition(
  currentState: GitHubJobStatus,
  nextState: GitHubJobStatus
): boolean {
  const validTransitions = GITHUB_STATE_TRANSITIONS[currentState];
  return validTransitions.includes(nextState);
}

/**
 * Check if state is terminal (no further transitions)
 */
export function isTerminalState(state: GitHubJobStatus): boolean {
  return (
    state === GitHubJobStatus.COMPLETE ||
    state === GitHubJobStatus.FAILED
  );
}

/**
 * Check if state is retryable
 */
export function isRetryableState(state: GitHubJobStatus): boolean {
  // FAILED state can be retried based on error.retryable flag
  return state === GitHubJobStatus.FAILED;
}

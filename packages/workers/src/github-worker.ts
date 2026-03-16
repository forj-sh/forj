/**
 * GitHub worker - BullMQ job handlers for GitHub operations
 *
 * Handles:
 * - Organization verification
 * - Repository creation
 * - Repository configuration (branch protection, Pages, topics)
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import {
  GitHubClient,
  GitHubError,
  GitHubErrorCategory,
  type GitHubJobData,
  type GitHubWorkerConfig,
  type GitHubWorkerEvent,
  type IGitHubWorkerEventPublisher,
  type VerifyOrgJobData,
  type CreateRepoJobData,
  type ConfigureRepoJobData,
  GitHubOperationType,
  GitHubJobStatus,
  GitHubWorkerEventType,
  isValidGitHubStateTransition,
  DEFAULT_BRANCH_PROTECTION,
  WORKER_LOCK_DURATION,
  WORKER_LOCK_RENEW_TIME,
} from '@forj/shared';
import { updateProjectService, fetchUserCredentials } from './database.js';

/**
 * GitHub worker class
 */
export class GitHubWorker {
  private worker: Worker<GitHubJobData>;
  private redis: Redis;
  private eventPublisher?: IGitHubWorkerEventPublisher;

  constructor(config: GitHubWorkerConfig) {
    this.redis = new Redis(config.redis);
    this.eventPublisher = config.eventPublisher;

    this.worker = new Worker<GitHubJobData>(
      'github',
      async (job) => this.processJob(job),
      {
        connection: config.redis,
        concurrency: config.concurrency || 3,
        // Lock configuration to prevent "Missing lock" errors
        // See packages/shared/src/worker-config.ts for default values
        lockDuration: WORKER_LOCK_DURATION,
        lockRenewTime: WORKER_LOCK_RENEW_TIME,
      }
    );

    this.setupEventHandlers();
  }

  /**
   * Set up worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`GitHub job ${job.id} completed`);

      // Only mark service as 'complete' in DB if it's the terminal operation.
      // GitHub jobs are multi-step (VERIFY_ORG → CREATE_REPO → CONFIGURE_REPO),
      // and the 'completed' event fires for each operation. We only want to mark
      // the service complete when repository configuration finishes successfully.
      if (job.data.operation === GitHubOperationType.CONFIGURE_REPO) {
        const value = ('repoUrl' in job.data ? job.data.repoUrl : job.data.orgName) as string | undefined;
        const now = new Date().toISOString();

        void updateProjectService(job.data.projectId, 'github', {
          status: 'complete',
          value,
          updatedAt: now,
          completedAt: now,
        }).catch((err) => {
          console.error('Failed to update project status in database:', err);
        });
      }
    });

    this.worker.on('failed', (job, err) => {
      console.error(`GitHub job ${job?.id} failed:`, err);

      if (job) {
        // Use user-friendly error message if available
        const errorMessage = err instanceof GitHubError ? err.getUserMessage() : err.message;

        // Update database with failure status
        void updateProjectService(job.data.projectId, 'github', {
          status: 'failed',
          error: errorMessage,
          updatedAt: new Date().toISOString(),
        }).catch((dbErr) => {
          console.error('Failed to update project status in database:', dbErr);
        });
      }
    });

    this.worker.on('error', (err) => {
      console.error('GitHub worker error:', err);
    });
  }

  /**
   * Process GitHub job based on operation type
   */
  private async processJob(job: Job<GitHubJobData>): Promise<void> {
    const { operation } = job.data;

    switch (operation) {
      case GitHubOperationType.VERIFY_ORG:
        return this.handleVerifyOrg(job as Job<VerifyOrgJobData>);
      case GitHubOperationType.CREATE_REPO:
        return this.handleCreateRepo(job as Job<CreateRepoJobData>);
      case GitHubOperationType.CONFIGURE_REPO:
        return this.handleConfigureRepo(job as Job<ConfigureRepoJobData>);
      default:
        throw new Error(`Unknown GitHub operation: ${operation}`);
    }
  }

  /**
   * Handle organization verification
   */
  private async handleVerifyOrg(job: Job<VerifyOrgJobData>): Promise<void> {
    const { userId, projectId, orgName } = job.data;

    // Track current state locally (starts as QUEUED when job is picked up)
    let currentState = GitHubJobStatus.QUEUED;

    // Update state: QUEUED → VERIFYING_ORG
    await this.updateJobState(job, currentState, GitHubJobStatus.VERIFYING_ORG);
    currentState = GitHubJobStatus.VERIFYING_ORG;

    await this.publishEvent({
      type: GitHubWorkerEventType.ORG_VERIFICATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: { orgName, status: GitHubJobStatus.VERIFYING_ORG },
    });

    try {
      // Fetch user credentials from database
      const credentials = await fetchUserCredentials(userId);
      if (!credentials?.githubAccessToken) {
        throw new GitHubError(
          `GitHub credentials not found for user ${userId}`,
          GitHubErrorCategory.AUTH
        );
      }

      const client = new GitHubClient({ accessToken: credentials.githubAccessToken });
      const org = await client.verifyOrg(orgName);

      // Update state: VERIFYING_ORG → ORG_VERIFIED
      await this.updateJobState(job, currentState, GitHubJobStatus.ORG_VERIFIED);
      currentState = GitHubJobStatus.ORG_VERIFIED;

      await this.publishEvent({
        type: GitHubWorkerEventType.ORG_VERIFICATION_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: {
          orgName,
          orgId: org.id,
          status: GitHubJobStatus.ORG_VERIFIED,
        },
      });

      // Store org details in job data (extend runtime data)
      await job.updateData({
        ...job.data,
        orgId: org.id,
        orgUrl: org.html_url,
      } as VerifyOrgJobData);
    } catch (error) {
      const githubError = error as GitHubError;
      await this.handleJobError(job, currentState, githubError, GitHubWorkerEventType.ORG_VERIFICATION_FAILED);
    }
  }

  /**
   * Handle repository creation
   */
  private async handleCreateRepo(job: Job<CreateRepoJobData>): Promise<void> {
    const {
      userId,
      projectId,
      orgName,
      repoName,
      repoDescription,
      isPrivate,
      autoInit,
      gitignoreTemplate,
      licenseTemplate,
    } = job.data;

    // Track current state locally (starts as ORG_VERIFIED)
    let currentState = GitHubJobStatus.ORG_VERIFIED;

    // Update state: ORG_VERIFIED → CREATING_REPO
    await this.updateJobState(job, currentState, GitHubJobStatus.CREATING_REPO);
    currentState = GitHubJobStatus.CREATING_REPO;
    await this.publishEvent({
      type: GitHubWorkerEventType.REPO_CREATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        orgName,
        repoName,
        status: GitHubJobStatus.CREATING_REPO,
      },
    });

    try {
      // Fetch user credentials from database
      const credentials = await fetchUserCredentials(userId);
      if (!credentials?.githubAccessToken) {
        throw new GitHubError(
          `GitHub credentials not found for user ${userId}`,
          GitHubErrorCategory.AUTH
        );
      }

      const client = new GitHubClient({ accessToken: credentials.githubAccessToken });

      // Create repository
      const repo = await client.createRepo(orgName, {
        name: repoName,
        description: repoDescription,
        private: isPrivate ?? true, // Default to private
        auto_init: autoInit ?? true, // Default to auto-init with README
        gitignore_template: gitignoreTemplate,
        license_template: licenseTemplate,
        has_issues: true,
        has_projects: true,
        has_wiki: false, // Disable wiki by default
        allow_squash_merge: true,
        allow_merge_commit: false, // Disable merge commits
        allow_rebase_merge: true,
        delete_branch_on_merge: true, // Auto-delete branches
      });

      // Update state: CREATING_REPO → REPO_CREATED
      await this.updateJobState(job, currentState, GitHubJobStatus.REPO_CREATED);
      currentState = GitHubJobStatus.REPO_CREATED;

      await this.publishEvent({
        type: GitHubWorkerEventType.REPO_CREATION_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: {
          orgName,
          repoName,
          repoUrl: repo.html_url,
          repoId: repo.id,
          status: GitHubJobStatus.REPO_CREATED,
        },
      });

      // Store repo details in job data (extend runtime data)
      await job.updateData({
        ...job.data,
        repoId: repo.id,
        repoUrl: repo.html_url,
        repoFullName: repo.full_name,
        defaultBranch: repo.default_branch,
      } as CreateRepoJobData);
    } catch (error) {
      const githubError = error as GitHubError;

      // If repo already exists, consider it a success (idempotent)
      if (githubError.category === GitHubErrorCategory.VALIDATION &&
          githubError.response?.errors?.some(e => e.code === 'already_exists')) {
        console.log(`Repository ${orgName}/${repoName} already exists, continuing...`);

        // Fetch user credentials from database (reuse from earlier)
        const credentials = await fetchUserCredentials(userId);
        if (!credentials?.githubAccessToken) {
          throw new GitHubError(
            `GitHub credentials not found for user ${userId}`,
            GitHubErrorCategory.AUTH
          );
        }

        // Fetch existing repo details
        const client = new GitHubClient({ accessToken: credentials.githubAccessToken });
        const repo = await client.getRepo(orgName, repoName);

        await this.updateJobState(job, currentState, GitHubJobStatus.REPO_CREATED);
        currentState = GitHubJobStatus.REPO_CREATED;

        await this.publishEvent({
          type: GitHubWorkerEventType.REPO_CREATION_COMPLETE,
          projectId,
          userId,
          jobId: job.id!,
          timestamp: new Date().toISOString(),
          data: {
            orgName,
            repoName,
            repoUrl: repo.html_url,
            repoId: repo.id,
            status: GitHubJobStatus.REPO_CREATED,
            alreadyExisted: true,
          },
        });

        await job.updateData({
          ...job.data,
          repoId: repo.id,
          repoUrl: repo.html_url,
          repoFullName: repo.full_name,
          defaultBranch: repo.default_branch,
        } as CreateRepoJobData);
      } else {
        await this.handleJobError(job, currentState, githubError, GitHubWorkerEventType.REPO_CREATION_FAILED);
      }
    }
  }

  /**
   * Handle repository configuration
   */
  private async handleConfigureRepo(job: Job<ConfigureRepoJobData>): Promise<void> {
    const {
      userId,
      projectId,
      orgName,
      repoName,
      enableBranchProtection,
      enablePages,
      pagesBranch,
      pagesPath,
      customDomain,
      topics,
    } = job.data;

    // Track current state locally (starts as REPO_CREATED)
    let currentState = GitHubJobStatus.REPO_CREATED;

    // Update state: REPO_CREATED → CONFIGURING
    await this.updateJobState(job, currentState, GitHubJobStatus.CONFIGURING);
    currentState = GitHubJobStatus.CONFIGURING;
    await this.publishEvent({
      type: GitHubWorkerEventType.REPO_CONFIGURATION_STARTED,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        orgName,
        repoName,
        status: GitHubJobStatus.CONFIGURING,
      },
    });

    try {
      // Fetch user credentials from database
      const credentials = await fetchUserCredentials(userId);
      if (!credentials?.githubAccessToken) {
        throw new GitHubError(
          `GitHub credentials not found for user ${userId}`,
          GitHubErrorCategory.AUTH
        );
      }

      const client = new GitHubClient({ accessToken: credentials.githubAccessToken });
      const repo = await client.getRepo(orgName, repoName);
      const configSteps: string[] = [];

      // Configure branch protection
      if (enableBranchProtection) {
        await client.setBranchProtection(
          orgName,
          repoName,
          repo.default_branch,
          DEFAULT_BRANCH_PROTECTION
        );
        configSteps.push('branch_protection');
      }

      // Configure GitHub Pages
      if (enablePages) {
        try {
          await client.configurePages(orgName, repoName, {
            source: {
              branch: pagesBranch || repo.default_branch,
              path: pagesPath || '/',
            },
            cname: customDomain,
          });
          configSteps.push('github_pages');
        } catch (error) {
          // Pages might already be enabled - check if it's specifically a Pages conflict
          const githubError = error as GitHubError;
          const isPageConflict =
            githubError.category === GitHubErrorCategory.CONFLICT &&
            githubError.statusCode === 409 &&
            (githubError.response?.message?.toLowerCase().includes('page') ||
             githubError.response?.message?.toLowerCase().includes('already'));

          if (isPageConflict) {
            console.log(`GitHub Pages already enabled for ${orgName}/${repoName}`);
            configSteps.push('github_pages_already_enabled');
          } else {
            throw error;
          }
        }
      }

      // Set repository topics
      if (topics && topics.length > 0) {
        await client.setRepoTopics(orgName, repoName, topics);
        configSteps.push('topics');
      }

      // Update state: CONFIGURING → COMPLETE
      await this.updateJobState(job, currentState, GitHubJobStatus.COMPLETE);
      currentState = GitHubJobStatus.COMPLETE;
      await this.publishEvent({
        type: GitHubWorkerEventType.REPO_CONFIGURATION_COMPLETE,
        projectId,
        userId,
        jobId: job.id!,
        timestamp: new Date().toISOString(),
        data: {
          orgName,
          repoName,
          repoUrl: repo.html_url,
          configSteps,
          status: GitHubJobStatus.COMPLETE,
        },
      });
    } catch (error) {
      const githubError = error as GitHubError;
      await this.handleJobError(job, currentState, githubError, GitHubWorkerEventType.REPO_CONFIGURATION_FAILED);
    }
  }

  /**
   * Update job state with validation
   */
  private async updateJobState(
    job: Job<GitHubJobData>,
    currentState: GitHubJobStatus,
    newState: GitHubJobStatus
  ): Promise<void> {
    if (!isValidGitHubStateTransition(currentState, newState)) {
      throw new Error(
        `Invalid state transition: ${currentState} → ${newState}`
      );
    }

    await job.updateProgress({ status: newState });
  }

  /**
   * Handle job error
   */
  private async handleJobError(
    job: Job<GitHubJobData>,
    currentState: GitHubJobStatus,
    error: GitHubError,
    eventType: GitHubWorkerEventType
  ): Promise<void> {
    const { userId, projectId, orgName } = job.data;
    const repoName = 'repoName' in job.data ? job.data.repoName : undefined;

    await this.updateJobState(job, currentState, GitHubJobStatus.FAILED);
    await this.publishEvent({
      type: eventType,
      projectId,
      userId,
      jobId: job.id!,
      timestamp: new Date().toISOString(),
      data: {
        orgName,
        repoName,
        error: error.getUserMessage(),
        errorCategory: error.category,
        status: GitHubJobStatus.FAILED,
      },
    });

    // Determine if error is retryable
    if (error.retryable) {
      throw error; // Let BullMQ retry
    } else {
      // Non-retryable error - fail permanently
      throw new UnrecoverableError(error.message);
    }
  }

  /**
   * Publish event to Redis pub/sub
   */
  private async publishEvent(event: GitHubWorkerEvent): Promise<void> {
    if (this.eventPublisher) {
      await this.eventPublisher.publishEvent(event);
    }

    // Also publish to Redis pub/sub for SSE streaming
    await this.redis.publish(
      `project:${event.projectId}:events`,
      JSON.stringify(event)
    );
  }

  /**
   * Close worker and Redis connection
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
  }
}

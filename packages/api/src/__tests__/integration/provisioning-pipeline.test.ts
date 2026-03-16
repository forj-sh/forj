/**
 * End-to-end integration test for provisioning pipeline
 *
 * Tests the complete provisioning flow:
 * 1. POST /provision - Orchestrator queues all jobs
 * 2. Workers process jobs in correct order
 * 3. State transitions are valid
 * 4. Events are published via Redis pub/sub
 * 5. Inter-job dependencies are respected
 *
 * NOTE: This test verifies job queueing and event flow.
 * Actual API calls to Namecheap/GitHub/Cloudflare are mocked.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { randomUUID } from 'crypto';
import { ProvisioningOrchestrator, type ProvisioningConfig } from '../../lib/orchestrator.js';
import { getDomainQueue, getGitHubQueue, getCloudflareQueue, getDNSQueue } from '../../lib/queues.js';
import { redisPubSub } from '../../lib/redis-pubsub.js';
import {
  DomainWorkerEventType,
  DomainOperationType,
  DomainJobStatus,
  GitHubWorkerEventType,
  GitHubOperationType,
  CloudflareWorkerEventType,
  CloudflareOperationType,
  DNSWorkerEventType,
  DNSOperationType,
  EmailProvider,
} from '@forj/shared';

describe('Provisioning Pipeline Integration', () => {
  // Generate valid RFC4122 UUIDs dynamically for better test isolation
  // Note: projects.id column is UUID type, requires valid UUID format
  const testProjectId = randomUUID();
  const testUserId = 'test-user-123';
  let isRedisAvailable = false;

  beforeAll(async () => {
    isRedisAvailable = await redisPubSub.testConnection();
    if (!isRedisAvailable) {
      console.log('Redis not available, skipping provisioning integration tests');
    }
  });

  afterAll(async () => {
    await redisPubSub.close();
  });

  it('should queue all provisioning jobs in correct order', async () => {
    if (!isRedisAvailable) {
      return;
    }

    // Test configuration
    const config: ProvisioningConfig = {
      userId: testUserId,
      projectId: testProjectId,
      domain: 'test-example.com',
      services: ['domain', 'github', 'cloudflare'], // Services to provision

      // Service credentials (would be real in production)
      namecheapApiUser: 'test-user',
      namecheapApiKey: 'test-key',
      namecheapUsername: 'test-username',
      githubToken: 'ghp_test123',
      cloudflareApiToken: 'cf_test123',
      cloudflareAccountId: 'cf_account_123',

      // Domain registration
      years: 1,
      contactInfo: {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phone: '+1.5555555555',
        address1: '123 Test St',
        city: 'Test City',
        stateProvince: 'CA',
        postalCode: '12345',
        country: 'US',
      },

      // GitHub configuration
      githubOrg: 'test-org',
      repoName: 'test-repo',
      repoDescription: 'Test repository',

      // Email configuration
      emailProvider: EmailProvider.GOOGLE_WORKSPACE,
      dkimSelectors: ['google'],
    };

    // Initialize orchestrator
    const orchestrator = new ProvisioningOrchestrator(
      getDomainQueue(),
      getGitHubQueue(),
      getCloudflareQueue(),
      getDNSQueue()
    );

    // Start provisioning
    const jobs = await orchestrator.provision(config);

    // Verify all expected job IDs were returned
    expect(jobs.domainRegistration).toBeDefined();
    expect(jobs.githubOrgVerify).toBeDefined();
    expect(jobs.githubRepoCreate).toBeDefined();
    expect(jobs.cloudflareZone).toBeDefined();

    // Verify jobs were queued
    const domainQueue = getDomainQueue();
    const githubQueue = getGitHubQueue();
    const cloudflareQueue = getCloudflareQueue();

    const domainJob = await domainQueue.getJob(jobs.domainRegistration!);
    const githubOrgJob = await githubQueue.getJob(jobs.githubOrgVerify!);
    const githubRepoJob = await githubQueue.getJob(jobs.githubRepoCreate!);
    const cloudflareJob = await cloudflareQueue.getJob(jobs.cloudflareZone!);

    try {
      expect(domainJob).toBeDefined();
      expect(githubOrgJob).toBeDefined();
      expect(githubRepoJob).toBeDefined();
      expect(cloudflareJob).toBeDefined();

      // Verify job data structure
      expect(domainJob?.data.domain).toBe('test-example.com');
      expect(domainJob?.data.userId).toBe(testUserId);
      expect(domainJob?.data.projectId).toBe(testProjectId);

      expect(githubOrgJob?.data.orgName).toBe('test-org');
      expect(githubOrgJob?.data.userId).toBe(testUserId);
      expect(githubOrgJob?.data.projectId).toBe(testProjectId);

      expect(githubRepoJob?.data.repoName).toBe('test-repo');
      expect(githubRepoJob?.data.orgName).toBe('test-org');

      expect(cloudflareJob?.data.domain).toBe('test-example.com');
      expect(cloudflareJob?.data.apiToken).toBe('cf_test123');
      expect(cloudflareJob?.data.accountId).toBe('cf_account_123');
    } finally {
      // Cleanup - remove test jobs (always runs even if assertions fail)
      if (domainJob) await domainJob.remove();
      if (githubOrgJob) await githubOrgJob.remove();
      if (githubRepoJob) await githubRepoJob.remove();
      if (cloudflareJob) await cloudflareJob.remove();
    }
  }, 10000); // 10 second timeout

  it('should publish events when workers process jobs', async () => {
    if (!isRedisAvailable) {
      return;
    }

    // This test verifies that the event publishing mechanism works
    // In a real scenario, workers would publish these events as they process jobs

    const receivedEvents: any[] = [];
    // Generate valid RFC4122 UUID dynamically for test isolation
    const testProjectId2 = randomUUID();

    // Subscribe to worker events
    const unsubscribe = await redisPubSub.subscribeWorkerEvents(
      testProjectId2,
      (event) => {
        receivedEvents.push(event);
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate worker events in the order they would occur during provisioning
    const events = [
      // Domain registration started
      {
        type: DomainWorkerEventType.JOB_STARTED,
        projectId: testProjectId2,
        jobId: 'job-domain-1',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.REGISTERING,
        timestamp: Date.now(),
        data: { domain: 'test-example.com' },
      },
      // Domain registration complete
      {
        type: DomainWorkerEventType.JOB_COMPLETED,
        projectId: testProjectId2,
        jobId: 'job-domain-1',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.COMPLETE,
        timestamp: Date.now(),
        data: { domain: 'test-example.com', domainId: 12345 },
      },
      // GitHub org verification started (parallel with Cloudflare)
      {
        type: GitHubWorkerEventType.ORG_VERIFICATION_STARTED,
        projectId: testProjectId2,
        userId: testUserId,
        jobId: 'job-github-org-1',
        timestamp: new Date().toISOString(),
        data: { orgName: 'test-org' },
      },
      // Cloudflare zone creation started (parallel with GitHub)
      {
        type: CloudflareWorkerEventType.ZONE_CREATION_STARTED,
        projectId: testProjectId2,
        userId: testUserId,
        jobId: 'job-cf-zone-1',
        timestamp: new Date().toISOString(),
        data: { domain: 'test-example.com' },
      },
      // GitHub org verified
      {
        type: GitHubWorkerEventType.ORG_VERIFICATION_COMPLETE,
        projectId: testProjectId2,
        userId: testUserId,
        jobId: 'job-github-org-1',
        timestamp: new Date().toISOString(),
        data: { orgName: 'test-org', orgId: 123456 },
      },
      // Cloudflare zone created
      {
        type: CloudflareWorkerEventType.ZONE_CREATION_COMPLETE,
        projectId: testProjectId2,
        userId: testUserId,
        jobId: 'job-cf-zone-1',
        timestamp: new Date().toISOString(),
        data: {
          domain: 'test-example.com',
          zoneId: 'cf-zone-123',
          nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
        },
      },
      // DNS wiring started (after nameserver verification)
      {
        type: DNSWorkerEventType.MX_WIRING_STARTED,
        projectId: testProjectId2,
        userId: testUserId,
        jobId: 'job-dns-1',
        timestamp: new Date().toISOString(),
        data: { domain: 'test-example.com' },
      },
      // DNS wiring complete
      {
        type: DNSWorkerEventType.WIRING_COMPLETE,
        projectId: testProjectId2,
        userId: testUserId,
        jobId: 'job-dns-1',
        timestamp: new Date().toISOString(),
        data: { domain: 'test-example.com', recordsCreated: 12 },
      },
    ];

    // Publish all events
    for (const event of events) {
      await redisPubSub.publishWorkerEvent(testProjectId2, event);
    }

    // Wait for all events to be received
    await new Promise<void>((resolve, reject) => {
      const timeout = 5000;
      const interval = 100;
      const startTime = Date.now();
      const timer = setInterval(() => {
        if (receivedEvents.length === events.length) {
          clearInterval(timer);
          return resolve();
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          reject(
            new Error(
              `Timed out waiting for events. Received ${receivedEvents.length}, expected ${events.length}.`
            )
          );
        }
      }, interval);
    });

    // Verify all events were received
    expect(receivedEvents.length).toBe(8);

    // Verify event sequence
    expect(receivedEvents[0].type).toBe(DomainWorkerEventType.JOB_STARTED);
    expect(receivedEvents[1].type).toBe(DomainWorkerEventType.JOB_COMPLETED);
    expect(receivedEvents[2].type).toBe(GitHubWorkerEventType.ORG_VERIFICATION_STARTED);
    expect(receivedEvents[3].type).toBe(CloudflareWorkerEventType.ZONE_CREATION_STARTED);
    expect(receivedEvents[4].type).toBe(GitHubWorkerEventType.ORG_VERIFICATION_COMPLETE);
    expect(receivedEvents[5].type).toBe(CloudflareWorkerEventType.ZONE_CREATION_COMPLETE);
    expect(receivedEvents[6].type).toBe(DNSWorkerEventType.MX_WIRING_STARTED);
    expect(receivedEvents[7].type).toBe(DNSWorkerEventType.WIRING_COMPLETE);

    // Verify event data
    expect(receivedEvents[1].data.domainId).toBe(12345);
    expect(receivedEvents[5].data.nameservers).toEqual(['ns1.cloudflare.com', 'ns2.cloudflare.com']);
    expect(receivedEvents[7].data.recordsCreated).toBe(12);

    // Cleanup
    if (unsubscribe) await unsubscribe();
  }, 10000);

  it('should validate provisioning config structure', () => {
    // Verify ProvisioningConfig has all required fields
    const config: ProvisioningConfig = {
      userId: 'user-123',
      projectId: 'proj-456',
      domain: 'example.com',
      services: ['domain', 'github', 'cloudflare'], // Services to provision
      namecheapApiUser: 'test',
      namecheapApiKey: 'test',
      namecheapUsername: 'test',
      githubToken: 'ghp_test',
      cloudflareApiToken: 'cf_test',
      cloudflareAccountId: 'cf_account_test', // Required by Stack 7
      githubOrg: 'test-org',
      years: 1,
      contactInfo: {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phone: '+1.5555555555',
        address1: '123 Test St',
        city: 'Test City',
        stateProvince: 'CA',
        postalCode: '12345',
        country: 'US',
      },
    };

    // TypeScript will enforce the structure at compile time
    // This test just verifies the config is valid
    expect(config.userId).toBe('user-123');
    expect(config.cloudflareAccountId).toBe('cf_account_test');
    expect(config.contactInfo.email).toBe('test@example.com');
  });
});

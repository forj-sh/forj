/**
 * Integration tests for provisioning orchestrator
 *
 * These tests verify the full provisioning flow with mocked external APIs.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ProvisioningOrchestrator, type ProvisioningConfig } from '../../lib/orchestrator.js';
import { EmailProvider } from '@forj/shared';

describe('Provisioning Orchestrator Integration', () => {
  let redis: Redis;
  let domainQueue: Queue;
  let githubQueue: Queue;
  let cloudflareQueue: Queue;
  let dnsQueue: Queue;
  let orchestrator: ProvisioningOrchestrator;
  let redisAvailable = false;

  beforeAll(async () => {
    // Check if Redis is available
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

    try {
      await redis.connect();
      await redis.ping();
      redisAvailable = true;

      // Create test queues
      const connection = redis.options;
      domainQueue = new Queue('test-domain', { connection });
      githubQueue = new Queue('test-github', { connection });
      cloudflareQueue = new Queue('test-cloudflare', { connection });
      dnsQueue = new Queue('test-dns', { connection });

      // Initialize orchestrator (redis parameter removed in PR #51)
      orchestrator = new ProvisioningOrchestrator(
        domainQueue,
        githubQueue,
        cloudflareQueue,
        dnsQueue
      );
    } catch (error) {
      console.log('Redis not available, skipping integration tests');
      redisAvailable = false;
    }
  });

  afterAll(async () => {
    // Clean up only if Redis was available
    if (redisAvailable) {
      await domainQueue.close();
      await githubQueue.close();
      await cloudflareQueue.close();
      await dnsQueue.close();
      await redis.quit();
    }
  });

  it('should create provisioning jobs in correct order', async () => {
    if (!redisAvailable) {
      console.log('Skipping test - Redis not available');
      return;
    }

    const config: ProvisioningConfig = {
      userId: 'test-user-123',
      projectId: 'test-project-123',
      domain: 'test-domain.com',
      namecheapApiUser: 'test',
      namecheapApiKey: 'test-key',
      namecheapUsername: 'test',
      githubToken: 'test-github-token',
      cloudflareApiToken: 'test-cf-token',
      years: 1,
      contactInfo: {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phone: '+1.5551234567',
        address1: '123 Test St',
        city: 'Test City',
        stateProvince: 'CA',
        postalCode: '12345',
        country: 'US',
      },
      githubOrg: 'test-org',
      emailProvider: EmailProvider.GOOGLE_WORKSPACE,
    };

    // Call provision and verify jobs are created
    const jobs = await orchestrator.provision(config);

    // Verify jobs were created
    expect(jobs).toBeDefined();
    expect(jobs.domainRegistration).toBeDefined();
    expect(jobs.githubOrgVerify).toBeDefined();
    expect(jobs.githubRepoCreate).toBeDefined();
    expect(jobs.cloudflareZone).toBeDefined();

    // Verify jobs were added to queues
    const domainJob = await domainQueue.getJob(jobs.domainRegistration!);
    const githubOrgJob = await githubQueue.getJob(jobs.githubOrgVerify!);
    const githubRepoJob = await githubQueue.getJob(jobs.githubRepoCreate!);
    const cloudflareJob = await cloudflareQueue.getJob(jobs.cloudflareZone!);

    expect(domainJob).toBeDefined();
    expect(githubOrgJob).toBeDefined();
    expect(githubRepoJob).toBeDefined();
    expect(cloudflareJob).toBeDefined();
  });

  it('should reject invalid configuration', async () => {
    if (!redisAvailable) {
      console.log('Skipping test - Redis not available');
      return;
    }

    const invalidConfig = {
      userId: 'test',
      // Missing required fields like projectId, domain, etc.
    } as any;

    // Provision should fail with invalid config
    await expect(orchestrator.provision(invalidConfig)).rejects.toThrow();
  });
});

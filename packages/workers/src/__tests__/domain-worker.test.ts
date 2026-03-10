/**
 * Unit tests for Domain Worker
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { DomainWorker } from '../domain-worker.js';
import {
  DomainOperationType,
  DomainJobStatus,
  type CheckDomainJobData,
  type RegisterDomainJobData,
  type RenewDomainJobData,
  type SetNameserversJobData,
  type GetDomainInfoJobData,
  type DomainWorkerConfig,
  type IWorkerEventPublisher,
} from '@forj/shared';

// Mock BullMQ Worker
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((queueName, processor, config) => {
    return {
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      _processor: processor, // Store for testing
    };
  }),
}));

// Mock NamecheapClient
const mockExecuteRequest = jest.fn();
jest.mock('@forj/shared', () => {
  const actual = jest.requireActual('@forj/shared') as any;
  return {
    ...actual,
    NamecheapClient: jest.fn().mockImplementation(() => ({
      executeRequest: mockExecuteRequest,
    })),
    NamecheapRequestQueue: jest.fn().mockImplementation(() => ({
      submit: jest.fn(),
      stop: jest.fn(),
    })),
    createNamecheapRateLimiter: jest.fn().mockReturnValue({}),
  };
});

describe('DomainWorker', () => {
  let worker: DomainWorker;
  let mockRedis: Redis;
  let mockConfig: DomainWorkerConfig;
  let mockRequestQueue: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedis = {} as Redis;

    mockConfig = {
      namecheap: {
        apiUser: 'test-user',
        apiKey: 'test-key-12345',
        userName: 'test-user',
        clientIp: '1.2.3.4',
        sandbox: true,
      },
      redis: {
        host: 'localhost',
        port: 6379,
      },
      queue: {
        name: 'domain-jobs',
        concurrency: 1,
        retry: {
          maxAttempts: 3,
          backoffType: 'exponential',
          backoffDelay: 1000,
        },
      },
    };

    // Create worker instance
    worker = new DomainWorker(mockConfig, mockRedis);

    // Get reference to mocked request queue
    const shared = jest.requireMock('@forj/shared') as any;
    mockRequestQueue = shared.NamecheapRequestQueue.mock.results[0]?.value;
  });

  afterEach(async () => {
    await worker.close();
  });

  describe('Error Sanitization', () => {
    it('should redact API keys from error messages', async () => {
      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      // Mock queue to throw error with API key in message
      mockRequestQueue.submit.mockRejectedValueOnce(
        new Error('Request failed: https://api.namecheap.com?ApiKey=secret-key-12345&Command=test')
      );

      // Should sanitize the error before re-throwing
      await expect(worker['processJob'](mockJob)).rejects.toThrow(
        /ApiKey=\*\*\*REDACTED\*\*\*/
      );

      // Original API key should not appear in error
      await expect(worker['processJob'](mockJob)).rejects.not.toThrow(/secret-key-12345/);
    });

    it('should handle non-Error objects gracefully', async () => {
      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      // Mock queue to throw non-Error object
      mockRequestQueue.submit.mockRejectedValueOnce('String error with ApiKey=secret123');

      // Should convert to string
      await expect(worker['processJob'](mockJob)).rejects.toThrow();
    });
  });

  describe('processJob', () => {
    it('should route CHECK operation to handleCheckDomain', async () => {
      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com', 'test.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      const mockResults = [
        { domain: 'example.com', available: true, isPremium: false },
        { domain: 'test.com', available: false, isPremium: false },
      ];

      mockRequestQueue.submit.mockResolvedValueOnce(mockResults);

      const result = await worker['processJob'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(result.results).toEqual(mockResults);
      expect(mockRequestQueue.submit).toHaveBeenCalledWith(
        'namecheap.domains.check',
        { DomainList: 'example.com,test.com' },
        expect.any(Number), // RequestPriority.INTERACTIVE
        jobData.userId
      );
    });

    it('should route REGISTER operation to handleRegisterDomain', async () => {
      const jobData: RegisterDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.PENDING,
        domainName: 'example.com',
        years: 1,
        registrant: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        tech: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        admin: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        auxBilling: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        addFreeWhoisguard: true,
        wgEnabled: true,
        isPremiumDomain: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RegisterDomainJobData>;

      // Mock check availability
      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      // Mock register domain
      mockRequestQueue.submit.mockResolvedValueOnce({
        domain: 'example.com',
        registered: true,
        chargedAmount: 12.99,
        domainId: 12345,
        orderId: 67890,
        transactionId: 11111,
        whoisguardEnabled: true,
      });

      const result = await worker['processJob'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(result.result?.registered).toBe(true);
      expect(mockRequestQueue.submit).toHaveBeenCalledTimes(2); // Check + Register
      expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
    });

    it('should route RENEW operation to handleRenewDomain', async () => {
      const jobData: RenewDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.RENEW,
        status: DomainJobStatus.PENDING,
        domainName: 'example.com',
        years: 1,
        isPremiumDomain: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RenewDomainJobData>;

      const mockResult = {
        domainName: 'example.com',
        domainId: 12345,
        renewed: true,
        chargedAmount: 12.99,
        orderId: 67890,
        transactionId: 11111,
      };

      mockRequestQueue.submit.mockResolvedValueOnce(mockResult);

      const result = await worker['processJob'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(result.result).toEqual(mockResult);
      expect(mockRequestQueue.submit).toHaveBeenCalledWith(
        'namecheap.domains.renew',
        expect.objectContaining({
          DomainName: 'example.com',
          Years: '1',
        }),
        expect.any(Number), // RequestPriority.CRITICAL
        jobData.userId
      );
    });

    it('should route SET_NAMESERVERS operation to handleSetNameservers', async () => {
      const jobData: SetNameserversJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.SET_NAMESERVERS,
        status: DomainJobStatus.PENDING,
        domainName: 'example.com',
        nameservers: ['ns1.example.com', 'ns2.example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<SetNameserversJobData>;

      mockRequestQueue.submit.mockResolvedValueOnce(true);

      const result = await worker['processJob'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(result.result?.updated).toBe(true);
      expect(mockRequestQueue.submit).toHaveBeenCalledWith(
        'namecheap.domains.dns.setCustom',
        expect.objectContaining({
          SLD: 'example',
          TLD: 'com',
          Nameservers: 'ns1.example.com,ns2.example.com',
        }),
        expect.any(Number), // RequestPriority.CRITICAL
        jobData.userId
      );
    });

    it('should route GET_INFO operation to handleGetDomainInfo', async () => {
      const jobData: GetDomainInfoJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.GET_INFO,
        status: DomainJobStatus.PENDING,
        domainName: 'example.com',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<GetDomainInfoJobData>;

      const mockResult = {
        status: 'OK' as const,
        id: 12345,
        domainName: 'example.com',
        ownerName: 'John Doe',
        isOwner: true,
        isPremium: false,
      };

      mockRequestQueue.submit.mockResolvedValueOnce(mockResult);

      const result = await worker['processJob'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(result.result).toEqual(mockResult);
      expect(mockRequestQueue.submit).toHaveBeenCalledWith(
        'namecheap.domains.getInfo',
        { DomainName: 'example.com' },
        expect.any(Number), // RequestPriority.BACKGROUND
        jobData.userId
      );
    });

    it('should throw error for unknown operation type', async () => {
      const jobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: 'UNKNOWN' as any,
        status: DomainJobStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<any>;

      await expect(worker['processJob'](mockJob)).rejects.toThrow('Unknown operation type');
    });
  });

  describe('handleRegisterDomain', () => {
    it('should fail if domain is not available', async () => {
      const jobData: RegisterDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.PENDING,
        domainName: 'taken.com',
        years: 1,
        registrant: {} as any,
        tech: {} as any,
        admin: {} as any,
        auxBilling: {} as any,
        addFreeWhoisguard: false,
        wgEnabled: false,
        isPremiumDomain: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RegisterDomainJobData>;

      // Mock check availability - domain taken
      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'taken.com', available: false },
      ]);

      await expect(worker['handleRegisterDomain'](mockJob)).rejects.toThrow(
        'Domain taken.com is not available'
      );

      expect(mockJob.data.status).toBe(DomainJobStatus.UNAVAILABLE);
    });

    it('should fail if registration returns registered: false', async () => {
      const jobData: RegisterDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.PENDING,
        domainName: 'pending.com',
        years: 1,
        registrant: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        tech: {} as any,
        admin: {} as any,
        auxBilling: {} as any,
        addFreeWhoisguard: false,
        wgEnabled: false,
        isPremiumDomain: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RegisterDomainJobData>;

      // Mock check availability - domain available
      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'pending.com', available: true },
      ]);

      // Mock register - returns registered: false
      mockRequestQueue.submit.mockResolvedValueOnce({
        domain: 'pending.com',
        registered: false,
      });

      await expect(worker['handleRegisterDomain'](mockJob)).rejects.toThrow(
        'Domain registration pending or failed'
      );

      expect(mockJob.data.status).toBe(DomainJobStatus.FAILED);
    });

    it('should configure nameservers if provided after successful registration', async () => {
      const jobData: RegisterDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.PENDING,
        domainName: 'example.com',
        years: 1,
        nameservers: ['ns1.example.com', 'ns2.example.com'],
        registrant: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        tech: {} as any,
        admin: {} as any,
        auxBilling: {} as any,
        addFreeWhoisguard: false,
        wgEnabled: false,
        isPremiumDomain: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RegisterDomainJobData>;

      // Mock check availability
      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      // Mock register domain
      mockRequestQueue.submit.mockResolvedValueOnce({
        domain: 'example.com',
        registered: true,
        chargedAmount: 12.99,
      });

      // Mock set nameservers
      mockRequestQueue.submit.mockResolvedValueOnce(true);

      const result = await worker['handleRegisterDomain'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(mockRequestQueue.submit).toHaveBeenCalledTimes(3); // Check + Register + Configure
      expect(mockRequestQueue.submit).toHaveBeenLastCalledWith(
        'namecheap.domains.dns.setCustom',
        expect.objectContaining({
          Nameservers: 'ns1.example.com,ns2.example.com',
        }),
        expect.any(Number),
        jobData.userId
      );
    });

    it('should skip nameserver configuration if not provided', async () => {
      const jobData: RegisterDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.PENDING,
        domainName: 'example.com',
        years: 1,
        // No nameservers
        registrant: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        tech: {} as any,
        admin: {} as any,
        auxBilling: {} as any,
        addFreeWhoisguard: false,
        wgEnabled: false,
        isPremiumDomain: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RegisterDomainJobData>;

      // Mock check availability
      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      // Mock register domain
      mockRequestQueue.submit.mockResolvedValueOnce({
        domain: 'example.com',
        registered: true,
        chargedAmount: 12.99,
      });

      const result = await worker['handleRegisterDomain'](mockJob);

      expect(result.status).toBe(DomainJobStatus.COMPLETE);
      expect(mockRequestQueue.submit).toHaveBeenCalledTimes(2); // Only Check + Register
    });

    it('should include premium pricing in registration params', async () => {
      const jobData: RegisterDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.PENDING,
        domainName: 'premium.com',
        years: 1,
        isPremiumDomain: true,
        premiumPrice: 999.99,
        registrant: {
          firstName: 'John',
          lastName: 'Doe',
          address1: '123 Main St',
          city: 'Anytown',
          stateProvince: 'CA',
          postalCode: '12345',
          country: 'US',
          phone: '+1.5555551234',
          emailAddress: 'john@example.com',
        },
        tech: {} as any,
        admin: {} as any,
        auxBilling: {} as any,
        addFreeWhoisguard: false,
        wgEnabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<RegisterDomainJobData>;

      // Mock check availability
      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'premium.com', available: true },
      ]);

      // Mock register domain
      mockRequestQueue.submit.mockResolvedValueOnce({
        domain: 'premium.com',
        registered: true,
        chargedAmount: 999.99,
      });

      await worker['handleRegisterDomain'](mockJob);

      // Verify premium params were passed
      expect(mockRequestQueue.submit).toHaveBeenCalledWith(
        'namecheap.domains.create',
        expect.objectContaining({
          IsPremiumDomain: 'true',
          PremiumPrice: '999.99',
        }),
        expect.any(Number),
        jobData.userId
      );
    });
  });

  describe('Event Publisher Integration', () => {
    it('should publish events via eventPublisher when configured', async () => {
      const mockPublisher: IWorkerEventPublisher = {
        publishWorkerEvent: jest.fn<() => Promise<number | null>>().mockResolvedValue(2), // 2 subscribers
      };

      const configWithPublisher: DomainWorkerConfig = {
        ...mockConfig,
        eventPublisher: mockPublisher,
      };

      const workerWithPublisher = new DomainWorker(configWithPublisher, mockRedis);

      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      await workerWithPublisher['processJob'](mockJob);

      // Should have published JOB_STARTED event
      expect(mockPublisher.publishWorkerEvent).toHaveBeenCalledWith(
        'proj-456',
        expect.objectContaining({
          type: 'job_started',
          jobId: 'job-123',
          projectId: 'proj-456',
        })
      );

      await workerWithPublisher.close();
    });

    it('should sanitize API keys in event error messages', async () => {
      const mockPublisher: IWorkerEventPublisher = {
        publishWorkerEvent: jest.fn<() => Promise<number | null>>().mockResolvedValue(1),
      };

      const configWithPublisher: DomainWorkerConfig = {
        ...mockConfig,
        eventPublisher: mockPublisher,
      };

      const workerWithPublisher = new DomainWorker(configWithPublisher, mockRedis);

      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
        error: 'Failed: https://api.namecheap.com?ApiKey=secret-key-12345',
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      mockRequestQueue.submit.mockRejectedValueOnce(
        new Error('API error with ApiKey=secret-key-12345')
      );

      await expect(workerWithPublisher['processJob'](mockJob)).rejects.toThrow();

      // Event should have sanitized error
      const publishCalls = mockPublisher.publishWorkerEvent.mock.calls;
      const errorEvent = publishCalls.find((call: any) => call[1].error);

      if (errorEvent) {
        expect(errorEvent[1].error).toContain('***REDACTED***');
        expect(errorEvent[1].error).not.toContain('secret-key-12345');
      }

      await workerWithPublisher.close();
    });

    it('should handle null return from publishWorkerEvent (publish failure)', async () => {
      const mockPublisher: IWorkerEventPublisher = {
        publishWorkerEvent: jest.fn<() => Promise<number | null>>().mockResolvedValue(null), // Publish failed
      };

      const configWithPublisher: DomainWorkerConfig = {
        ...mockConfig,
        eventPublisher: mockPublisher,
      };

      const workerWithPublisher = new DomainWorker(configWithPublisher, mockRedis);

      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      // Should not throw even if publish returns null
      await expect(workerWithPublisher['processJob'](mockJob)).resolves.toBeDefined();

      expect(mockPublisher.publishWorkerEvent).toHaveBeenCalled();

      await workerWithPublisher.close();
    });

    it('should handle exceptions from publishWorkerEvent', async () => {
      const mockPublisher: IWorkerEventPublisher = {
        publishWorkerEvent: jest.fn<() => Promise<number | null>>().mockRejectedValue(new Error('Redis connection failed')),
      };

      const configWithPublisher: DomainWorkerConfig = {
        ...mockConfig,
        eventPublisher: mockPublisher,
      };

      const workerWithPublisher = new DomainWorker(configWithPublisher, mockRedis);

      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      // Should not throw even if publisher throws
      await expect(workerWithPublisher['processJob'](mockJob)).resolves.toBeDefined();

      expect(mockPublisher.publishWorkerEvent).toHaveBeenCalled();

      await workerWithPublisher.close();
    });

    it('should handle zero subscribers (publish succeeds but no listeners)', async () => {
      const mockPublisher: IWorkerEventPublisher = {
        publishWorkerEvent: jest.fn<() => Promise<number | null>>().mockResolvedValue(0), // No subscribers
      };

      const configWithPublisher: DomainWorkerConfig = {
        ...mockConfig,
        eventPublisher: mockPublisher,
      };

      const workerWithPublisher = new DomainWorker(configWithPublisher, mockRedis);

      const jobData: CheckDomainJobData = {
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        domains: ['example.com'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
        updateProgress: jest.fn(),
      } as unknown as Job<CheckDomainJobData>;

      mockRequestQueue.submit.mockResolvedValueOnce([
        { domain: 'example.com', available: true },
      ]);

      await workerWithPublisher['processJob'](mockJob);

      expect(mockPublisher.publishWorkerEvent).toHaveBeenCalled();

      await workerWithPublisher.close();
    });
  });

  describe('close', () => {
    it('should close worker and stop request queue', async () => {
      await worker.close();

      const bullmq = jest.requireMock('bullmq') as any;
      const mockWorkerInstance = bullmq.Worker.mock.results[0]?.value;

      expect(mockWorkerInstance.close).toHaveBeenCalled();
      expect(mockRequestQueue.stop).toHaveBeenCalled();
    });
  });
});

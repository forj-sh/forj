/**
 * Unit tests for Redis Pub/Sub client
 *
 * Stack 1: Redis pub/sub infrastructure for worker events
 *
 * Tests the RedisPubSub class with mocked ioredis connections.
 * Integration tests with real Redis are in e2e tests.
 */

import { jest } from '@jest/globals';
import type { DomainWorkerEvent, DomainWorkerEventType, DomainOperationType, DomainJobStatus } from '@forj/shared';

// Mock ioredis before importing
const mockPublish = jest.fn<() => Promise<number>>();
const mockSubscribe = jest.fn<() => Promise<number>>();
const mockUnsubscribe = jest.fn<() => Promise<number>>();
const mockQuit = jest.fn<() => Promise<string>>();
const mockOn = jest.fn<(...args: any[]) => void>();

const MockRedis = jest.fn().mockImplementation(() => ({
  publish: mockPublish,
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  quit: mockQuit,
  on: mockOn,
}));

jest.unstable_mockModule('ioredis', () => ({
  default: MockRedis,
}));

// Import after mocking
const { RedisPubSub, getWorkerEventChannel } = await import('../redis-pubsub.js');

describe('RedisPubSub', () => {
  let pubsub: InstanceType<typeof RedisPubSub>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock implementations to return promises
    mockQuit.mockResolvedValue('OK');

    // Provide test Redis URL
    pubsub = new RedisPubSub('redis://localhost:6379');
  });

  afterEach(async () => {
    await pubsub.close();
  });

  describe('getWorkerEventChannel', () => {
    it('should return correct channel name', () => {
      expect(getWorkerEventChannel('project-123')).toBe('worker:events:project-123');
      expect(getWorkerEventChannel('abc')).toBe('worker:events:abc');
    });
  });

  describe('publishWorkerEvent', () => {
    const mockEvent: DomainWorkerEvent = {
      type: 'job_completed' as DomainWorkerEventType,
      jobId: 'job-123',
      projectId: 'project-456',
      operation: 'CHECK' as DomainOperationType,
      status: 'complete' as DomainJobStatus,
      timestamp: Date.now(),
    };

    it('should publish event to correct channel', async () => {
      mockPublish.mockResolvedValueOnce(1); // 1 subscriber

      const result = await pubsub.publishWorkerEvent('project-456', mockEvent);

      expect(result).toBe(1);
      expect(MockRedis).toHaveBeenCalled();
      expect(mockPublish).toHaveBeenCalledWith(
        'worker:events:project-456',
        JSON.stringify(mockEvent)
      );
    });

    it('should return subscriber count on success', async () => {
      mockPublish.mockResolvedValueOnce(3); // 3 subscribers

      const result = await pubsub.publishWorkerEvent('project-456', mockEvent);

      expect(result).toBe(3);
    });

    it('should return null on publish error', async () => {
      mockPublish.mockRejectedValueOnce(new Error('Redis error'));

      const result = await pubsub.publishWorkerEvent('project-456', mockEvent);

      expect(result).toBeNull();
    });

    it('should handle missing Redis URL', async () => {
      // Temporarily remove REDIS_URL from env to ensure deterministic test
      const originalRedisUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;

      try {
        const noPubSub = new RedisPubSub(undefined);
        const result = await noPubSub.publishWorkerEvent('project-456', mockEvent);

        expect(result).toBeNull();
      } finally {
        // Restore original value
        if (originalRedisUrl !== undefined) {
          process.env.REDIS_URL = originalRedisUrl;
        } else {
          delete process.env.REDIS_URL;
        }
      }
    });
  });

  describe('subscribeWorkerEvents', () => {
    const mockEvent: DomainWorkerEvent = {
      type: 'job_progress' as DomainWorkerEventType,
      jobId: 'job-789',
      projectId: 'project-abc',
      operation: 'REGISTER' as DomainOperationType,
      status: 'running' as DomainJobStatus,
      timestamp: Date.now(),
      data: { progress: 50 },
    };

    it('should subscribe to correct channel', async () => {
      mockSubscribe.mockResolvedValueOnce(1);

      const callback = jest.fn();
      const unsubscribe = await pubsub.subscribeWorkerEvents('project-abc', callback);

      expect(unsubscribe).not.toBeNull();
      expect(MockRedis).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalledWith('worker:events:project-abc');
    });

    it('should call callback when message received', async () => {
      mockSubscribe.mockResolvedValueOnce(1);

      // Capture the message handler
      let messageHandler: ((channel: string, message: string) => void) | undefined;
      mockOn.mockImplementation((event: string, handler: any) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      });

      const callback = jest.fn();
      await pubsub.subscribeWorkerEvents('project-abc', callback);

      // Simulate receiving a message
      expect(messageHandler).toBeDefined();
      messageHandler!('worker:events:project-abc', JSON.stringify(mockEvent));

      expect(callback).toHaveBeenCalledWith(mockEvent);
    });

    it('should not call callback for wrong channel', async () => {
      mockSubscribe.mockResolvedValueOnce(1);

      let messageHandler: ((channel: string, message: string) => void) | undefined;
      mockOn.mockImplementation((event: string, handler: any) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      });

      const callback = jest.fn();
      await pubsub.subscribeWorkerEvents('project-abc', callback);

      // Simulate message from different channel
      messageHandler!('worker:events:different-project', JSON.stringify(mockEvent));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', async () => {
      mockSubscribe.mockResolvedValueOnce(1);

      let messageHandler: ((channel: string, message: string) => void) | undefined;
      mockOn.mockImplementation((event: string, handler: any) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      });

      const callback = jest.fn();
      await pubsub.subscribeWorkerEvents('project-abc', callback);

      // Simulate invalid JSON
      messageHandler!('worker:events:project-abc', 'invalid json{');

      // Callback should not be called
      expect(callback).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function', async () => {
      mockSubscribe.mockResolvedValueOnce(1);
      mockUnsubscribe.mockResolvedValueOnce(1);
      mockQuit.mockResolvedValueOnce('OK');

      const callback = jest.fn();
      const unsubscribe = await pubsub.subscribeWorkerEvents('project-abc', callback);

      expect(unsubscribe).not.toBeNull();

      // Call unsubscribe
      await unsubscribe!();

      expect(mockUnsubscribe).toHaveBeenCalledWith('worker:events:project-abc');
      expect(mockQuit).toHaveBeenCalled();
    });

    it('should return null on subscribe error', async () => {
      mockSubscribe.mockRejectedValueOnce(new Error('Redis error'));
      mockQuit.mockResolvedValueOnce('OK');

      const callback = jest.fn();
      const unsubscribe = await pubsub.subscribeWorkerEvents('project-abc', callback);

      expect(unsubscribe).toBeNull();
      expect(mockQuit).toHaveBeenCalled(); // Should cleanup failed subscriber
    });

    it('should handle missing Redis URL', async () => {
      // Temporarily remove REDIS_URL from env to ensure deterministic test
      const originalRedisUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;

      try {
        const noPubSub = new RedisPubSub(undefined);
        const callback = jest.fn();
        const unsubscribe = await noPubSub.subscribeWorkerEvents('project-abc', callback);

        expect(unsubscribe).toBeNull();
      } finally {
        // Restore original value
        if (originalRedisUrl !== undefined) {
          process.env.REDIS_URL = originalRedisUrl;
        } else {
          delete process.env.REDIS_URL;
        }
      }
    });
  });

  describe('close', () => {
    it('should close publisher connection', async () => {
      mockPublish.mockResolvedValueOnce(1);
      mockQuit.mockResolvedValueOnce('OK');

      // Trigger publisher creation
      await pubsub.publishWorkerEvent('project-test', {
        type: 'job_created' as DomainWorkerEventType,
        jobId: 'job-1',
        projectId: 'project-test',
        operation: 'CHECK' as DomainOperationType,
        status: 'pending' as DomainJobStatus,
        timestamp: Date.now(),
      });

      await pubsub.close();

      expect(mockQuit).toHaveBeenCalled();
    });

    it('should close all subscriber connections', async () => {
      mockSubscribe.mockResolvedValue(1);
      mockQuit.mockResolvedValue('OK');

      // Create multiple subscribers
      await pubsub.subscribeWorkerEvents('project-1', jest.fn());
      await pubsub.subscribeWorkerEvents('project-2', jest.fn());

      await pubsub.close();

      // Expect 2 subscriber quits
      expect(mockQuit).toHaveBeenCalledTimes(2);
    });

    it('should handle close with no connections', async () => {
      // Should not throw
      await expect(pubsub.close()).resolves.not.toThrow();
    });
  });
});

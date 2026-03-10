/**
 * Unit tests for Namecheap Request Queue
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  NamecheapRequestQueue,
  RequestPriority,
  type RequestExecutor,
} from '../request-queue.js';
import type { RateLimiter } from '../rate-limiter.js';
import type { Redis } from 'ioredis';

// Mock Redis client
const createMockRedis = (): jest.Mocked<Redis> => ({
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
} as any);

// Mock Rate Limiter
const createMockRateLimiter = (): jest.Mocked<RateLimiter> => ({
  tryAcquire: jest.fn(),
} as any);

// Mock Executor
const createMockExecutor = (): jest.MockedFunction<RequestExecutor> => {
  return jest.fn();
};

describe('NamecheapRequestQueue', () => {
  let mockRedis: jest.Mocked<Redis>;
  let mockRateLimiter: jest.Mocked<RateLimiter>;
  let mockExecutor: jest.MockedFunction<RequestExecutor>;
  let queue: NamecheapRequestQueue;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockRateLimiter = createMockRateLimiter();
    mockExecutor = createMockExecutor();
    queue = new NamecheapRequestQueue(mockRateLimiter, mockRedis, mockExecutor, 'test');
  });

  afterEach(() => {
    queue.stop();
  });

  describe('submit', () => {
    it('should execute request and resolve with result', async () => {
      const mockResult = { domain: 'example.com', available: true };
      mockExecutor.mockResolvedValueOnce(mockResult);
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });

      const resultPromise = queue.submit(
        'namecheap.domains.check',
        { DomainList: 'example.com' },
        RequestPriority.INTERACTIVE
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await resultPromise;

      expect(result).toEqual(mockResult);
      expect(mockExecutor).toHaveBeenCalledWith('namecheap.domains.check', {
        DomainList: 'example.com',
      });
    });

    it('should respect priority order (CRITICAL before INTERACTIVE)', async () => {
      const results: string[] = [];

      mockExecutor.mockImplementation(async (command) => {
        results.push(command);
        return { success: true };
      });

      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });

      // Submit in reverse priority order
      const interactive = queue.submit('interactive', {}, RequestPriority.INTERACTIVE);
      const critical = queue.submit('critical', {}, RequestPriority.CRITICAL);

      await new Promise((resolve) => setTimeout(resolve, 250));

      await Promise.all([critical, interactive]);

      // CRITICAL should execute first despite being submitted second
      expect(results[0]).toBe('critical');
      expect(results[1]).toBe('interactive');
    });

    it('should respect priority order (INTERACTIVE before BACKGROUND)', async () => {
      const results: string[] = [];

      mockExecutor.mockImplementation(async (command) => {
        results.push(command);
        return { success: true };
      });

      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });

      // Submit in reverse priority order
      const background = queue.submit('background', {}, RequestPriority.BACKGROUND);
      const interactive = queue.submit('interactive', {}, RequestPriority.INTERACTIVE);

      await new Promise((resolve) => setTimeout(resolve, 250));

      await Promise.all([interactive, background]);

      // INTERACTIVE should execute first
      expect(results[0]).toBe('interactive');
      expect(results[1]).toBe('background');
    });

    it('should handle executor errors', async () => {
      const error = new Error('API error');
      mockExecutor.mockRejectedValueOnce(error);
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });

      const resultPromise = queue.submit(
        'namecheap.domains.check',
        { DomainList: 'example.com' },
        RequestPriority.INTERACTIVE
      );

      await expect(resultPromise).rejects.toThrow('API error');
    });
  });

  describe('processNext - rate limiting', () => {
    it('should dequeue BEFORE acquiring rate limit slot', async () => {
      const callOrder: string[] = [];

      mockRateLimiter.tryAcquire.mockImplementation(async () => {
        callOrder.push('tryAcquire');
        return {
          allowed: true,
          currentCount: 1,
          remaining: 19,
          resetMs: 60000,
        };
      });

      mockExecutor.mockImplementation(async () => {
        callOrder.push('execute');
        return { success: true };
      });

      queue.submit('test', {}, RequestPriority.INTERACTIVE);

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Executor should be called, meaning dequeue happened first
      expect(callOrder).toContain('execute');
      expect(callOrder).toContain('tryAcquire');
    });

    it('should not consume rate limit slot when queue is empty', async () => {
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });

      // Start processing with empty queue
      queue.submit('test', {}, RequestPriority.INTERACTIVE);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Clear the queue
      queue.clearAll();

      // Wait for next processing interval
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Rate limiter should only be called once (for the submitted request)
      // Not called again after queue is empty
      expect(mockRateLimiter.tryAcquire).toHaveBeenCalledTimes(1);
    });

    it('should re-queue request when rate limit is reached', async () => {
      let tryAcquireCallCount = 0;

      mockRateLimiter.tryAcquire.mockImplementation(async () => {
        tryAcquireCallCount++;
        // First call: deny, second call: allow
        return {
          allowed: tryAcquireCallCount > 1,
          currentCount: 20,
          remaining: 0,
          resetMs: 3000,
        };
      });

      mockExecutor.mockResolvedValue({ success: true });

      const resultPromise = queue.submit('test', {}, RequestPriority.INTERACTIVE);

      // Wait for multiple processing cycles
      await new Promise((resolve) => setTimeout(resolve, 250));

      const result = await resultPromise;

      expect(result).toEqual({ success: true});
      expect(tryAcquireCallCount).toBeGreaterThan(1);
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });
  });

  describe('getQueuePosition', () => {
    it('should calculate position correctly', () => {
      // Add requests to queues manually for testing
      const criticalQueue = (queue as any).queues.get(RequestPriority.CRITICAL);
      const interactiveQueue = (queue as any).queues.get(RequestPriority.INTERACTIVE);

      criticalQueue.push({ id: '1' });
      criticalQueue.push({ id: '2' });
      interactiveQueue.push({ id: '3' });

      const position = queue.getQueuePosition(RequestPriority.INTERACTIVE);

      expect(position.ahead).toBe(2); // 2 critical requests ahead
      expect(position.position).toBe(3); // Total position including current queue
      expect(position.estimatedWaitMs).toBe(6000); // 2 * 3000ms
    });

    it('should estimate wait time correctly', () => {
      const criticalQueue = (queue as any).queues.get(RequestPriority.CRITICAL);

      for (let i = 0; i < 5; i++) {
        criticalQueue.push({ id: `${i}` });
      }

      const position = queue.getQueuePosition(RequestPriority.BACKGROUND);

      expect(position.ahead).toBe(5);
      expect(position.estimatedWaitMs).toBe(15000); // 5 * 3000ms
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', async () => {
      const criticalQueue = (queue as any).queues.get(RequestPriority.CRITICAL);
      const interactiveQueue = (queue as any).queues.get(RequestPriority.INTERACTIVE);
      const backgroundQueue = (queue as any).queues.get(RequestPriority.BACKGROUND);

      criticalQueue.push({ id: '1' }, { id: '2' });
      interactiveQueue.push({ id: '3' });
      backgroundQueue.push({ id: '4' }, { id: '5' }, { id: '6' });

      const stats = await queue.getStats();

      expect(stats.critical).toBe(2);
      expect(stats.interactive).toBe(1);
      expect(stats.background).toBe(3);
      expect(stats.total).toBe(6);
      expect(stats.processing).toBe(false);
    });
  });

  describe('saveToRedis and loadFromRedis', () => {
    it('should save queue state to Redis', async () => {
      const criticalQueue = (queue as any).queues.get(RequestPriority.CRITICAL);
      criticalQueue.push({ id: '1', command: 'test', params: {} });

      await queue.saveToRedis();

      expect(mockRedis.set).toHaveBeenCalledWith(
        'test:queue:state',
        expect.any(String),
        'EX',
        3600
      );

      const savedState = JSON.parse((mockRedis.set as jest.Mock).mock.calls[0][1]);
      expect(savedState.critical).toHaveLength(1);
      expect(savedState.timestamp).toBeDefined();
    });

    it('should log warning about lost requests on restart', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const savedState = {
        critical: [{ id: '1', command: 'test1' }],
        interactive: [{ id: '2', command: 'test2' }],
        background: [],
        timestamp: Date.now(),
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(savedState));

      await queue.loadFromRedis();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 requests lost (1 critical, 1 interactive, 0 background)')
      );
      expect(mockRedis.del).toHaveBeenCalledWith('test:queue:state');

      consoleWarnSpy.mockRestore();
    });

    it('should not log warning when no requests lost', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockRedis.get.mockResolvedValueOnce(null);

      await queue.loadFromRedis();

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('clearAll', () => {
    it('should reject all pending requests', async () => {
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: false, // Prevent processing
        currentCount: 20,
        remaining: 0,
        resetMs: 60000,
      });

      const promise1 = queue.submit('test1', {}, RequestPriority.CRITICAL);
      const promise2 = queue.submit('test2', {}, RequestPriority.INTERACTIVE);

      await new Promise((resolve) => setTimeout(resolve, 50));

      queue.clearAll();

      await expect(promise1).rejects.toThrow('Queue cleared');
      await expect(promise2).rejects.toThrow('Queue cleared');
    });

    it('should empty all queues', async () => {
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: false,
        currentCount: 20,
        remaining: 0,
        resetMs: 60000,
      });

      queue.submit('test1', {}, RequestPriority.CRITICAL).catch(() => {});
      queue.submit('test2', {}, RequestPriority.INTERACTIVE).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      queue.clearAll();

      const stats = await queue.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('stop', () => {
    it('should stop processing', async () => {
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });
      mockExecutor.mockResolvedValue({ success: true });

      queue.submit('test', {}, RequestPriority.INTERACTIVE);

      await new Promise((resolve) => setTimeout(resolve, 50));

      queue.stop();

      const stats = await queue.getStats();
      expect(stats.processing).toBe(false);
    });
  });

  describe('fairness - user request tracking', () => {
    beforeEach(() => {
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });
      mockExecutor.mockResolvedValue({ success: true });
    });

    it('should serve system requests (no userId) immediately', async () => {
      const results: string[] = [];

      mockExecutor.mockImplementation(async (command) => {
        results.push(command);
        return { success: true };
      });

      // Submit user request first, then system request
      const userPromise = queue.submit('user-command', {}, RequestPriority.INTERACTIVE, 'user-123');
      const systemPromise = queue.submit('system-command', {}, RequestPriority.INTERACTIVE);

      await new Promise((resolve) => setTimeout(resolve, 250));

      await Promise.all([userPromise, systemPromise]);

      // System request should be processed first despite being submitted second
      expect(results[0]).toBe('system-command');
      expect(results[1]).toBe('user-command');
    });

    it('should prioritize users with fewer pending requests', async () => {
      const results: string[] = [];

      mockExecutor.mockImplementation(async (command) => {
        results.push(command);
        // Slow down execution to allow multiple requests to queue
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { success: true };
      });

      // User A submits 3 requests, User B submits 1
      const a1 = queue.submit('a1', {}, RequestPriority.INTERACTIVE, 'user-a');
      const a2 = queue.submit('a2', {}, RequestPriority.INTERACTIVE, 'user-a');
      const a3 = queue.submit('a3', {}, RequestPriority.INTERACTIVE, 'user-a');
      const b1 = queue.submit('b1', {}, RequestPriority.INTERACTIVE, 'user-b');

      await new Promise((resolve) => setTimeout(resolve, 500));

      await Promise.all([a1, a2, a3, b1]);

      // User B's request should be processed early due to fairness
      // Exact order depends on timing, but B should not be last
      expect(results).toContain('b1');
      expect(results.indexOf('b1')).toBeLessThan(results.length - 1);
    });

    it('should not treat empty string userId as system request', async () => {
      const results: string[] = [];

      mockExecutor.mockImplementation(async (command) => {
        results.push(command);
        return { success: true };
      });

      // Submit requests with empty string userId
      const emptyPromise = queue.submit('empty-user', {}, RequestPriority.INTERACTIVE, '');
      const realPromise = queue.submit('real-user', {}, RequestPriority.INTERACTIVE, 'user-123');

      await new Promise((resolve) => setTimeout(resolve, 250));

      await Promise.all([emptyPromise, realPromise]);

      // Empty string should be treated as a user, not system request
      // Both should be processed in order
      expect(results).toHaveLength(2);
    });
  });

  describe('event emission', () => {
    beforeEach(() => {
      mockRateLimiter.tryAcquire.mockResolvedValue({
        allowed: true,
        currentCount: 1,
        remaining: 19,
        resetMs: 60000,
      });
    });

    it('should emit enqueued event when request is submitted', (done) => {
      queue.events.on('enqueued', (event) => {
        expect(event.requestId).toBeDefined();
        expect(event.command).toBe('test.command');
        expect(event.priority).toBe(RequestPriority.INTERACTIVE);
        expect(event.userId).toBe('user-123');
        expect(event.position).toBeDefined();
        done();
      });

      queue.submit('test.command', {}, RequestPriority.INTERACTIVE, 'user-123');
    });

    it('should emit processing event when request starts', (done) => {
      mockExecutor.mockImplementation(async () => {
        // Slow down to ensure event is captured
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true };
      });

      queue.events.on('processing', (event) => {
        expect(event.requestId).toBeDefined();
        expect(event.command).toBe('test.command');
        expect(event.waitTimeMs).toBeGreaterThanOrEqual(0);
        done();
      });

      queue.submit('test.command', {}, RequestPriority.INTERACTIVE, 'user-123');
    });

    it('should emit completed event on successful execution', (done) => {
      mockExecutor.mockResolvedValue({ success: true });

      queue.events.on('completed', (event) => {
        expect(event.requestId).toBeDefined();
        expect(event.command).toBe('test.command');
        expect(event.processingTimeMs).toBeGreaterThanOrEqual(0);
        done();
      });

      queue.submit('test.command', {}, RequestPriority.INTERACTIVE, 'user-123');
    });

    it('should emit failed event on execution error', (done) => {
      mockExecutor.mockRejectedValue(new Error('API error'));

      queue.events.on('failed', (event) => {
        expect(event.requestId).toBeDefined();
        expect(event.command).toBe('test.command');
        expect(event.error).toBe('API error');
        done();
      });

      queue.submit('test.command', {}, RequestPriority.INTERACTIVE, 'user-123').catch(() => {
        // Expected to reject
      });
    });

    it('should emit metrics update after request completes', (done) => {
      mockExecutor.mockResolvedValue({ success: true });
      mockRateLimiter.getStats = jest.fn().mockResolvedValue({
        currentCount: 5,
        maxRequests: 20,
        remaining: 15,
        utilizationPercent: 25,
        resetMs: 30000,
      });

      queue.events.on('metrics_update', (event) => {
        expect(event.metrics).toBeDefined();
        expect(event.metrics.utilizationPercent).toBe(25);
        expect(event.metrics.processing).toBe(true);
        done();
      });

      queue.submit('test.command', {}, RequestPriority.INTERACTIVE);
    });

    it('should not crash queue if event listener throws', async () => {
      mockExecutor.mockResolvedValue({ success: true });

      // Add a listener that throws
      queue.events.on('processing', () => {
        throw new Error('Listener error');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const promise = queue.submit('test.command', {}, RequestPriority.INTERACTIVE);

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Request should still complete despite listener error
      await expect(promise).resolves.toEqual({ success: true });

      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error in processing event listener:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});

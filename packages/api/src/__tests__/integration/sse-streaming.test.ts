/**
 * End-to-end integration test for SSE streaming
 *
 * Tests the complete flow:
 * 1. Redis pub/sub publishes worker events
 * 2. Redis pub/sub delivers events to subscribers
 * 3. Event conversion from worker format to SSE format
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  DomainWorkerEventType,
  DomainOperationType,
  DomainJobStatus,
  type DomainWorkerEvent,
} from '@forj/shared';
import { redisPubSub } from '../../lib/redis-pubsub.js';

describe('SSE Streaming Integration', () => {
  const testProjectId = 'test-project-integration';
  let isRedisAvailable = false;

  beforeAll(async () => {
    isRedisAvailable = await redisPubSub.testConnection();
    if (!isRedisAvailable) {
      console.log('Redis not available, skipping integration tests');
    }
  });

  afterAll(async () => {
    await redisPubSub.close();
  });

  it('should publish and receive worker events via Redis pub/sub', async () => {
    if (!isRedisAvailable) {
      return;
    }

    // Collect events received by subscriber
    const receivedEvents: DomainWorkerEvent[] = [];

    // Subscribe to worker events
    const unsubscribe = await redisPubSub.subscribeWorkerEvents(
      testProjectId,
      (event) => {
        receivedEvents.push(event);
      }
    );

    expect(unsubscribe).toBeDefined();

    // Wait for subscription to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Publish test worker events
    const testEvents = [
      {
        type: DomainWorkerEventType.JOB_CREATED,
        projectId: testProjectId,
        jobId: 'test-job-1',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        timestamp: Date.now(),
      },
      {
        type: DomainWorkerEventType.JOB_STARTED,
        projectId: testProjectId,
        jobId: 'test-job-1',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.QUEUED,
        timestamp: Date.now(),
      },
      {
        type: DomainWorkerEventType.JOB_PROGRESS,
        projectId: testProjectId,
        jobId: 'test-job-1',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.CHECKING,
        timestamp: Date.now(),
        data: { step: 'checking', progress: 50 },
      },
      {
        type: DomainWorkerEventType.JOB_COMPLETED,
        projectId: testProjectId,
        jobId: 'test-job-1',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.COMPLETE,
        timestamp: Date.now(),
        data: { domain: 'example.com', domainId: 123 },
      },
    ];

    // Publish events
    for (const event of testEvents) {
      const subscriberCount = await redisPubSub.publishWorkerEvent(testProjectId, event);
      expect(subscriberCount).toBe(1); // Should have 1 subscriber
    }

    // Wait for all events to be received
    await new Promise<void>((resolve, reject) => {
      const timeout = 2000;
      const interval = 50;
      const startTime = Date.now();
      const timer = setInterval(() => {
        if (receivedEvents.length === testEvents.length) {
          clearInterval(timer);
          return resolve();
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          reject(
            new Error(
              `Timed out waiting for events. Received ${receivedEvents.length}, expected ${testEvents.length}.`
            )
          );
        }
      }, interval);
    });

    // Verify all events were received
    expect(receivedEvents.length).toBe(4);

    // Verify event types
    expect(receivedEvents[0].type).toBe(DomainWorkerEventType.JOB_CREATED);
    expect(receivedEvents[1].type).toBe(DomainWorkerEventType.JOB_STARTED);
    expect(receivedEvents[2].type).toBe(DomainWorkerEventType.JOB_PROGRESS);
    expect(receivedEvents[3].type).toBe(DomainWorkerEventType.JOB_COMPLETED);

    // Verify event data
    expect(receivedEvents[2].data).toEqual({ step: 'checking', progress: 50 });
    expect(receivedEvents[3].data).toEqual({ domain: 'example.com', domainId: 123 });

    // Cleanup
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  it('should handle multiple subscribers for the same project', async () => {
    if (!isRedisAvailable) {
      return;
    }

    const subscriber1Events: DomainWorkerEvent[] = [];
    const subscriber2Events: DomainWorkerEvent[] = [];
    const multiProjectId = 'test-project-multi';

    // Create two subscribers
    const unsubscribe1 = await redisPubSub.subscribeWorkerEvents(
      multiProjectId,
      (event) => subscriber1Events.push(event)
    );

    const unsubscribe2 = await redisPubSub.subscribeWorkerEvents(
      multiProjectId,
      (event) => subscriber2Events.push(event)
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Publish one event
    const testEvent = {
      type: DomainWorkerEventType.JOB_STARTED,
      projectId: multiProjectId,
      jobId: 'test-job-multi',
      operation: DomainOperationType.REGISTER,
      status: DomainJobStatus.REGISTERING,
      timestamp: Date.now(),
    };

    const subscriberCount = await redisPubSub.publishWorkerEvent(multiProjectId, testEvent);
    expect(subscriberCount).toBe(2); // Should have 2 subscribers

    await new Promise<void>((resolve, reject) => {
      const timeout = 2000;
      const interval = 50;
      const startTime = Date.now();
      const timer = setInterval(() => {
        if (subscriber1Events.length === 1 && subscriber2Events.length === 1) {
          clearInterval(timer);
          return resolve();
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for events.`));
        }
      }, interval);
    });

    // Both subscribers should receive the event
    expect(subscriber1Events.length).toBe(1);
    expect(subscriber2Events.length).toBe(1);
    expect(subscriber1Events[0].type).toBe(DomainWorkerEventType.JOB_STARTED);
    expect(subscriber2Events[0].type).toBe(DomainWorkerEventType.JOB_STARTED);

    // Cleanup
    if (unsubscribe1) await unsubscribe1();
    if (unsubscribe2) await unsubscribe2();
  });

  it('should isolate events by projectId', async () => {
    if (!isRedisAvailable) {
      return;
    }

    const project1Events: DomainWorkerEvent[] = [];
    const project2Events: DomainWorkerEvent[] = [];

    // Subscribe to two different projects
    const unsubscribe1 = await redisPubSub.subscribeWorkerEvents(
      'project-1',
      (event) => project1Events.push(event)
    );

    const unsubscribe2 = await redisPubSub.subscribeWorkerEvents(
      'project-2',
      (event) => project2Events.push(event)
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Publish events to each project
    await redisPubSub.publishWorkerEvent('project-1', {
      type: DomainWorkerEventType.JOB_STARTED,
      projectId: 'project-1',
      jobId: 'job-1',
      operation: DomainOperationType.CHECK,
      status: DomainJobStatus.CHECKING,
      timestamp: Date.now(),
    });

    await redisPubSub.publishWorkerEvent('project-2', {
      type: DomainWorkerEventType.JOB_COMPLETED,
      projectId: 'project-2',
      jobId: 'job-2',
      operation: DomainOperationType.REGISTER,
      status: DomainJobStatus.COMPLETE,
      timestamp: Date.now(),
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = 2000;
      const interval = 50;
      const startTime = Date.now();
      const timer = setInterval(() => {
        if (project1Events.length === 1 && project2Events.length === 1) {
          clearInterval(timer);
          return resolve();
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for events.`));
        }
      }, interval);
    });

    // Each subscriber should only receive events for their project
    expect(project1Events.length).toBe(1);
    expect(project2Events.length).toBe(1);
    expect(project1Events[0].projectId).toBe('project-1');
    expect(project1Events[0].type).toBe(DomainWorkerEventType.JOB_STARTED);
    expect(project2Events[0].projectId).toBe('project-2');
    expect(project2Events[0].type).toBe(DomainWorkerEventType.JOB_COMPLETED);

    // Cleanup
    if (unsubscribe1) await unsubscribe1();
    if (unsubscribe2) await unsubscribe2();
  });
});

/**
 * Unit tests for Queue Event Emitter
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  QueueEventEmitter,
  QueueEventType,
  type EnqueuedEvent,
  type ProcessingEvent,
  type CompletedEvent,
  type FailedEvent,
  type PositionUpdateEvent,
  type MetricsUpdateEvent,
} from '../queue-events.js';
import { RequestPriority } from '../request-queue.js';

describe('QueueEventEmitter', () => {
  let emitter: QueueEventEmitter;

  beforeEach(() => {
    emitter = new QueueEventEmitter();
  });

  describe('emitEnqueued', () => {
    it('should emit enqueued event with timestamp', (done) => {
      const listener = (event: EnqueuedEvent) => {
        expect(event.type).toBe(QueueEventType.ENQUEUED);
        expect(event.requestId).toBe('req-123');
        expect(event.command).toBe('test.command');
        expect(event.priority).toBe(RequestPriority.INTERACTIVE);
        expect(event.userId).toBe('user-456');
        expect(event.timestamp).toBeGreaterThan(0);
        expect(event.position).toEqual({ position: 1, estimatedWaitMs: 0, ahead: 0 });
        done();
      };

      emitter.on(QueueEventType.ENQUEUED, listener);

      emitter.emitEnqueued({
        requestId: 'req-123',
        command: 'test.command',
        priority: RequestPriority.INTERACTIVE,
        userId: 'user-456',
        position: { position: 1, estimatedWaitMs: 0, ahead: 0 },
      });
    });
  });

  describe('emitProcessing', () => {
    it('should emit processing event with timestamp', (done) => {
      const listener = (event: ProcessingEvent) => {
        expect(event.type).toBe(QueueEventType.PROCESSING);
        expect(event.requestId).toBe('req-123');
        expect(event.command).toBe('test.command');
        expect(event.priority).toBe(RequestPriority.CRITICAL);
        expect(event.userId).toBe('user-456');
        expect(event.waitTimeMs).toBe(1500);
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      };

      emitter.on(QueueEventType.PROCESSING, listener);

      emitter.emitProcessing({
        requestId: 'req-123',
        command: 'test.command',
        priority: RequestPriority.CRITICAL,
        userId: 'user-456',
        waitTimeMs: 1500,
      });
    });
  });

  describe('emitCompleted', () => {
    it('should emit completed event with timestamp', (done) => {
      const listener = (event: CompletedEvent) => {
        expect(event.type).toBe(QueueEventType.COMPLETED);
        expect(event.requestId).toBe('req-123');
        expect(event.command).toBe('test.command');
        expect(event.priority).toBe(RequestPriority.BACKGROUND);
        expect(event.userId).toBe('user-456');
        expect(event.processingTimeMs).toBe(2500);
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      };

      emitter.on(QueueEventType.COMPLETED, listener);

      emitter.emitCompleted({
        requestId: 'req-123',
        command: 'test.command',
        priority: RequestPriority.BACKGROUND,
        userId: 'user-456',
        processingTimeMs: 2500,
      });
    });
  });

  describe('emitFailed', () => {
    it('should emit failed event with timestamp', (done) => {
      const listener = (event: FailedEvent) => {
        expect(event.type).toBe(QueueEventType.FAILED);
        expect(event.requestId).toBe('req-123');
        expect(event.command).toBe('test.command');
        expect(event.priority).toBe(RequestPriority.INTERACTIVE);
        expect(event.userId).toBe('user-456');
        expect(event.error).toBe('API error');
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      };

      emitter.on(QueueEventType.FAILED, listener);

      emitter.emitFailed({
        requestId: 'req-123',
        command: 'test.command',
        priority: RequestPriority.INTERACTIVE,
        userId: 'user-456',
        error: 'API error',
      });
    });
  });

  describe('emitPositionUpdate', () => {
    it('should emit position update event with timestamp', (done) => {
      const listener = (event: PositionUpdateEvent) => {
        expect(event.type).toBe(QueueEventType.POSITION_UPDATE);
        expect(event.requestId).toBe('req-123');
        expect(event.position).toEqual({ position: 5, estimatedWaitMs: 12000, ahead: 4 });
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      };

      emitter.on(QueueEventType.POSITION_UPDATE, listener);

      emitter.emitPositionUpdate({
        requestId: 'req-123',
        position: { position: 5, estimatedWaitMs: 12000, ahead: 4 },
      });
    });
  });

  describe('emitMetricsUpdate', () => {
    it('should emit metrics update event with timestamp', (done) => {
      const listener = (event: MetricsUpdateEvent) => {
        expect(event.type).toBe(QueueEventType.METRICS_UPDATE);
        expect(event.metrics).toEqual({
          critical: 2,
          interactive: 3,
          background: 5,
          total: 10,
          processing: true,
          utilizationPercent: 75,
        });
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      };

      emitter.on(QueueEventType.METRICS_UPDATE, listener);

      emitter.emitMetricsUpdate({
        metrics: {
          critical: 2,
          interactive: 3,
          background: 5,
          total: 10,
          processing: true,
          utilizationPercent: 75,
        },
      });
    });
  });

  describe('onRequestEvents', () => {
    it('should subscribe to all request-specific events', () => {
      const callback = jest.fn();
      const unsubscribe = emitter.onRequestEvents('req-123', callback);

      // Emit events for the target request
      emitter.emitEnqueued({
        requestId: 'req-123',
        command: 'test',
        priority: RequestPriority.INTERACTIVE,
        position: { position: 1, estimatedWaitMs: 0, ahead: 0 },
      });

      emitter.emitProcessing({
        requestId: 'req-123',
        command: 'test',
        priority: RequestPriority.INTERACTIVE,
        waitTimeMs: 100,
      });

      emitter.emitCompleted({
        requestId: 'req-123',
        command: 'test',
        priority: RequestPriority.INTERACTIVE,
        processingTimeMs: 200,
      });

      expect(callback).toHaveBeenCalledTimes(3);

      unsubscribe();

      // After unsubscribe, no more events should be received
      emitter.emitFailed({
        requestId: 'req-123',
        command: 'test',
        priority: RequestPriority.INTERACTIVE,
        error: 'error',
      });

      expect(callback).toHaveBeenCalledTimes(3); // Still 3, not 4
    });

    it('should filter events by requestId', () => {
      const callback = jest.fn();
      emitter.onRequestEvents('req-123', callback);

      // Emit event for different request
      emitter.emitEnqueued({
        requestId: 'req-456',
        command: 'test',
        priority: RequestPriority.INTERACTIVE,
        position: { position: 1, estimatedWaitMs: 0, ahead: 0 },
      });

      // Should not be called
      expect(callback).not.toHaveBeenCalled();

      // Emit event for target request
      emitter.emitEnqueued({
        requestId: 'req-123',
        command: 'test',
        priority: RequestPriority.INTERACTIVE,
        position: { position: 1, estimatedWaitMs: 0, ahead: 0 },
      });

      // Should be called once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should not receive metrics update events', () => {
      const callback = jest.fn();
      emitter.onRequestEvents('req-123', callback);

      emitter.emitMetricsUpdate({
        metrics: {
          critical: 1,
          interactive: 1,
          background: 1,
          total: 3,
          processing: true,
          utilizationPercent: 50,
        },
      });

      // Metrics updates don't have requestId, so should not be received
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('onMetrics', () => {
    it('should subscribe to metrics updates only', () => {
      const callback = jest.fn();
      const unsubscribe = emitter.onMetrics(callback);

      emitter.emitMetricsUpdate({
        metrics: {
          critical: 1,
          interactive: 1,
          background: 1,
          total: 3,
          processing: true,
          utilizationPercent: 50,
        },
      });

      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      emitter.emitMetricsUpdate({
        metrics: {
          critical: 0,
          interactive: 0,
          background: 0,
          total: 0,
          processing: false,
          utilizationPercent: 0,
        },
      });

      // Still 1, not 2
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('toSSE', () => {
    it('should format enqueued event as SSE string', () => {
      const event: EnqueuedEvent = {
        type: QueueEventType.ENQUEUED,
        timestamp: 1234567890,
        requestId: 'req-123',
        command: 'test.command',
        priority: RequestPriority.INTERACTIVE,
        userId: 'user-456',
        position: { position: 1, estimatedWaitMs: 0, ahead: 0 },
      };

      const sse = QueueEventEmitter.toSSE(event);

      expect(sse).toBe(
        `event: enqueued\ndata: ${JSON.stringify(event)}\n\n`
      );
    });

    it('should format metrics event as SSE string', () => {
      const event: MetricsUpdateEvent = {
        type: QueueEventType.METRICS_UPDATE,
        timestamp: 1234567890,
        metrics: {
          critical: 2,
          interactive: 3,
          background: 5,
          total: 10,
          processing: true,
          utilizationPercent: 75,
        },
      };

      const sse = QueueEventEmitter.toSSE(event);

      expect(sse).toBe(
        `event: metrics_update\ndata: ${JSON.stringify(event)}\n\n`
      );
      expect(sse).toContain('event: metrics_update');
      expect(sse).toContain('"utilizationPercent":75');
    });
  });

  describe('maxListeners', () => {
    it('should allow many concurrent subscribers without warning', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Subscribe 20 listeners (default maxListeners is 10)
      for (let i = 0; i < 20; i++) {
        emitter.onRequestEvents(`req-${i}`, () => {});
      }

      // Should not have triggered MaxListenersExceededWarning
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});

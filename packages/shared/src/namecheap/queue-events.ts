/**
 * Queue events for SSE streaming
 *
 * Reference: project-docs/namecheap-integration-spec.md Section 4.6
 *
 * Emits queue position updates, processing events, and metrics
 * for real-time monitoring via Server-Sent Events.
 */

import { EventEmitter } from 'node:events';
import type { RequestPriority, QueuePosition } from './request-queue.js';

/**
 * Queue event types
 */
export enum QueueEventType {
  /** Request was enqueued */
  ENQUEUED = 'enqueued',
  /** Request started processing */
  PROCESSING = 'processing',
  /** Request completed successfully */
  COMPLETED = 'completed',
  /** Request failed */
  FAILED = 'failed',
  /** Queue position changed */
  POSITION_UPDATE = 'position_update',
  /** Queue metrics updated */
  METRICS_UPDATE = 'metrics_update',
}

/**
 * Base queue event
 */
export interface QueueEvent {
  type: QueueEventType;
  timestamp: number;
}

/**
 * Request enqueued event
 */
export interface EnqueuedEvent extends QueueEvent {
  type: QueueEventType.ENQUEUED;
  requestId: string;
  command: string;
  priority: RequestPriority;
  userId?: string;
  position: QueuePosition;
}

/**
 * Request processing event
 */
export interface ProcessingEvent extends QueueEvent {
  type: QueueEventType.PROCESSING;
  requestId: string;
  command: string;
  priority: RequestPriority;
  userId?: string;
  waitTimeMs: number;
}

/**
 * Request completed event
 */
export interface CompletedEvent extends QueueEvent {
  type: QueueEventType.COMPLETED;
  requestId: string;
  command: string;
  priority: RequestPriority;
  userId?: string;
  processingTimeMs: number;
}

/**
 * Request failed event
 */
export interface FailedEvent extends QueueEvent {
  type: QueueEventType.FAILED;
  requestId: string;
  command: string;
  priority: RequestPriority;
  userId?: string;
  error: string;
}

/**
 * Queue position update event
 */
export interface PositionUpdateEvent extends QueueEvent {
  type: QueueEventType.POSITION_UPDATE;
  requestId: string;
  position: QueuePosition;
}

/**
 * Queue metrics update event
 */
export interface MetricsUpdateEvent extends QueueEvent {
  type: QueueEventType.METRICS_UPDATE;
  metrics: {
    critical: number;
    interactive: number;
    background: number;
    total: number;
    processing: boolean;
    utilizationPercent: number;
  };
}

/**
 * Union type of all queue events
 */
export type QueueEventData =
  | EnqueuedEvent
  | ProcessingEvent
  | CompletedEvent
  | FailedEvent
  | PositionUpdateEvent
  | MetricsUpdateEvent;

/**
 * Queue event emitter for SSE streaming
 *
 * Extends Node.js EventEmitter for type-safe event handling.
 * Supports multiple concurrent SSE subscribers without MaxListenersExceededWarning.
 */
export class QueueEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Allow many concurrent SSE subscribers without MaxListenersExceededWarning
    // Default is 10, but with SSE streaming we may have many CLI clients
    this.setMaxListeners(0); // 0 = unlimited
  }
  /**
   * Emit an enqueued event
   */
  emitEnqueued(event: Omit<EnqueuedEvent, 'type' | 'timestamp'>): void {
    this.emit(QueueEventType.ENQUEUED, {
      ...event,
      type: QueueEventType.ENQUEUED,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a processing event
   */
  emitProcessing(event: Omit<ProcessingEvent, 'type' | 'timestamp'>): void {
    this.emit(QueueEventType.PROCESSING, {
      ...event,
      type: QueueEventType.PROCESSING,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a completed event
   */
  emitCompleted(event: Omit<CompletedEvent, 'type' | 'timestamp'>): void {
    this.emit(QueueEventType.COMPLETED, {
      ...event,
      type: QueueEventType.COMPLETED,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a failed event
   */
  emitFailed(event: Omit<FailedEvent, 'type' | 'timestamp'>): void {
    this.emit(QueueEventType.FAILED, {
      ...event,
      type: QueueEventType.FAILED,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a position update event
   */
  emitPositionUpdate(event: Omit<PositionUpdateEvent, 'type' | 'timestamp'>): void {
    this.emit(QueueEventType.POSITION_UPDATE, {
      ...event,
      type: QueueEventType.POSITION_UPDATE,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a metrics update event
   */
  emitMetricsUpdate(event: Omit<MetricsUpdateEvent, 'type' | 'timestamp'>): void {
    this.emit(QueueEventType.METRICS_UPDATE, {
      ...event,
      type: QueueEventType.METRICS_UPDATE,
      timestamp: Date.now(),
    });
  }

  /**
   * Subscribe to all events for a specific request
   *
   * WARNING: This method does not perform authorization checks. Callers must
   * verify that the subscriber is authorized to access events for the given
   * requestId. Failure to do so may result in information disclosure (IDOR).
   *
   * @param requestId - Request ID to monitor
   * @param callback - Callback for events
   * @returns Unsubscribe function
   */
  onRequestEvents(requestId: string, callback: (event: QueueEventData) => void): () => void {
    const handler = (event: QueueEventData) => {
      if ('requestId' in event && event.requestId === requestId) {
        callback(event);
      }
    };

    // Subscribe to relevant event types
    const eventTypes: QueueEventType[] = [
      QueueEventType.ENQUEUED,
      QueueEventType.PROCESSING,
      QueueEventType.COMPLETED,
      QueueEventType.FAILED,
      QueueEventType.POSITION_UPDATE,
    ];

    eventTypes.forEach((type) => this.on(type, handler));

    // Return unsubscribe function
    return () => {
      eventTypes.forEach((type) => this.off(type, handler));
    };
  }

  /**
   * Subscribe to metrics updates
   *
   * @param callback - Callback for metrics updates
   * @returns Unsubscribe function
   */
  onMetrics(callback: (event: MetricsUpdateEvent) => void): () => void {
    this.on(QueueEventType.METRICS_UPDATE, callback);
    return () => this.off(QueueEventType.METRICS_UPDATE, callback);
  }

  /**
   * Convert event to SSE format
   *
   * @param event - Queue event
   * @returns SSE-formatted string
   */
  static toSSE(event: QueueEventData): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }
}

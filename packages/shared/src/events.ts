import type { ServiceStatus, ServiceType } from './services.js';

/**
 * SSE event types
 */

/**
 * Generic SSE event
 */
export interface SSEEvent<T = unknown> {
  type: string;
  data: T;
  timestamp?: string;
}

/**
 * Service update event (emitted via SSE)
 */
export interface ServiceEvent {
  type: 'status';
  service?: ServiceType;
  status: ServiceStatus;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Provisioning complete event
 */
export interface CompleteEvent {
  type: 'complete';
  message?: string;
  data?: {
    projectId?: string;
    duration?: string;
    services?: ServiceType[] | Record<ServiceType, { status: ServiceStatus; value?: string }>;
  };
  timestamp?: string;
}

/**
 * Provisioning error event
 */
export interface ErrorEvent {
  type: 'error';
  error: string;
  code?: string;
}

/**
 * All SSE event types
 */
export type ProvisioningEvent = ServiceEvent | CompleteEvent | ErrorEvent;

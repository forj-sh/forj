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
  type: 'service_update';
  service: ServiceType;
  status: ServiceStatus;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Provisioning complete event
 * Services are optional to support partial/incremental provisioning
 */
export interface CompleteEvent {
  type: 'complete';
  data: {
    projectId: string;
    services: Partial<Record<ServiceType, { status: ServiceStatus; value?: string }>>;
  };
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

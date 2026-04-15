import EventSource from 'eventsource';
import { getApiUrl, getAuthToken } from './config.js';
import { ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Ora } from 'ora';
import type { ServiceEvent } from '@forj/shared';

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp?: string;
}

export interface SSEClientOptions {
  endpoint: string;
  onEvent?: (event: SSEEvent) => void;
  onServiceUpdate?: (event: ServiceEvent) => void;
  onComplete?: (data: unknown) => void;
  onError?: (error: Error) => void;
  timeoutMs?: number; // Optional timeout in milliseconds
}

/**
 * Create SSE client for streaming events from API
 */
export function createSSEClient(options: SSEClientOptions): {
  start: () => void;
  close: () => void;
} {
  const { endpoint, onEvent, onServiceUpdate, onComplete, onError, timeoutMs } = options;

  const apiUrl = getApiUrl();
  const token = getAuthToken();

  if (!token) {
    throw new ForjError(
      'Authentication required for SSE connection',
      'AUTH_REQUIRED'
    );
  }

  const url = `${apiUrl}${endpoint}`;
  let eventSource: EventSource | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  /**
   * Reset inactivity timeout - called when connection starts and on each received event
   * This implements an inactivity timeout (not total connection duration)
   */
  function resetTimeout() {
    // Clear existing timeout if any
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // Set new timeout if specified
    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        const timeoutError = new ForjError(
          `No events received for ${Math.floor(timeoutMs / 1000)} seconds. Provisioning may still be in progress on the server.`,
          'SSE_TIMEOUT'
        );

        if (onError) {
          onError(timeoutError);
        }

        close();
      }, timeoutMs);
    }
  }

  function start() {
    eventSource = new EventSource(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Start inactivity timeout
    resetTimeout();

    // Handle incoming messages
    eventSource.onmessage = (event) => {
      try {
        // Reset inactivity timeout on each received event
        resetTimeout();

        const data = JSON.parse(event.data);

        // Validate parsed data is not null/undefined
        if (!data) {
          logger.warn('Received empty SSE event data');
          return;
        }

        // Call generic event handler
        if (onEvent) {
          onEvent({
            type: event.type || 'message',
            data,
            timestamp: new Date().toISOString(),
          });
        }

        // Handle service-specific events with validation
        // Note: service field is optional (allows general status events)
        if (data.type === 'status' && onServiceUpdate) {
          if (data && typeof data.status === 'string') {
            onServiceUpdate(data as ServiceEvent);
          } else {
            logger.warn(`Received malformed 'status' event: ${JSON.stringify(data)}`);
          }
        }

        // Handle completion event
        if (data.type === 'complete' && onComplete) {
          onComplete(data.data);
          close();
        }

        // Handle error event (provisioning failure)
        if (data.type === 'error') {
          const errorMessage = (typeof data.error === 'string' && data.error) ? data.error : 'Provisioning failed';
          const errorCode = (typeof data.code === 'string' && data.code) ? data.code : 'UNKNOWN_ERROR';
          const provisioningError = new ForjError(errorMessage, errorCode);

          if (onError) {
            onError(provisioningError);
          }

          close();
        }
      } catch (error) {
        logger.error(`Failed to parse SSE event: ${error}`);
      }
    };

    // Handle errors - allow reconnection unless consumer explicitly closes
    eventSource.onerror = (error) => {
      const err = new ForjError(
        'SSE connection error. Will attempt to reconnect.',
        'SSE_CONNECTION_ERROR',
        error
      );

      if (onError) {
        // The consumer can decide to call close() if the error is fatal
        onError(err);
      } else {
        // Log the error but allow reconnection to proceed
        logger.warn(err.message);
      }
    };
  }

  function close() {
    // Clear timeout on close
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  return { start, close };
}

// Default timeout: 10 minutes
const DEFAULT_PROVISIONING_TIMEOUT_MS = 10 * 60 * 1000;

export interface ServiceStatus {
  status: string;
  message?: string;
}

export interface ProvisioningResult {
  data: unknown;
  failedServices: string[];
  partial: boolean;
  serviceStatuses: Map<string, ServiceStatus>;
}

/**
 * Stream provisioning progress with visual feedback
 *
 * @param patienceMs - If set, resolve with partial results after this many ms
 *   of streaming (timer starts on first service event). Useful for long-running
 *   operations like DNS propagation where the CLI shouldn't block indefinitely.
 */
export async function streamProvisioningProgress(
  endpoint: string,
  spinnerText: string = 'Provisioning...',
  timeoutMs: number = DEFAULT_PROVISIONING_TIMEOUT_MS,
  patienceMs?: number
): Promise<ProvisioningResult> {
  return new Promise((resolve, reject) => {
    const spinner = logger.spinner(spinnerText);
    const serviceSpinners = new Map<string, Ora>();
    const failedServices: string[] = [];
    const serviceStatuses = new Map<string, ServiceStatus>();
    let patienceTimerId: NodeJS.Timeout | null = null;
    let resolved = false;

    spinner.start();

    const client = createSSEClient({
      endpoint,
      timeoutMs,
      onServiceUpdate: (event) => {
        const { service, status, message, error } = event;

        // Skip events without a service (e.g., general status events)
        if (!service) {
          return;
        }

        // Track latest status per service
        serviceStatuses.set(service, { status, message: message || error });

        // Start patience timer on first service event
        if (patienceMs && !patienceTimerId && !resolved) {
          patienceTimerId = setTimeout(() => {
            if (resolved) return;
            resolved = true;

            // Stop spinning spinners with info state (not failure)
            if (spinner.isSpinning) spinner.stop();
            serviceSpinners.forEach((s, svc) => {
              if (s.isSpinning) {
                const info = serviceStatuses.get(svc);
                s.info(`${svc}: ${info?.message || 'In progress...'}`);
              }
            });

            client.close();
            resolve({ data: null, failedServices, partial: true, serviceStatuses });
          }, patienceMs);
        }

        // Stop the main spinner once we have service-level updates
        if (spinner.isSpinning) {
          spinner.stop();
        }

        // Get or create spinner for this service
        let serviceSpinner = serviceSpinners.get(service);

        if (!serviceSpinner) {
          serviceSpinner = logger.spinner(service);
          serviceSpinners.set(service, serviceSpinner);
        }

        switch (status) {
          case 'pending':
            serviceSpinner.start(`${service}: Pending`);
            break;

          case 'running':
            // Update text without restarting to avoid flicker
            if (serviceSpinner.isSpinning) {
              serviceSpinner.text = `${service}: ${message || 'Running'}`;
            } else {
              serviceSpinner.start(`${service}: ${message || 'Running'}`);
            }
            break;

          case 'complete':
            serviceSpinner.succeed(`${service}: ${message || 'Complete'}`);
            break;

          case 'failed':
            serviceSpinner.fail(`${service}: ${error || 'Failed'}`);
            failedServices.push(service);
            break;
        }
      },

      onComplete: (data) => {
        if (resolved) return;
        resolved = true;

        if (patienceTimerId) clearTimeout(patienceTimerId);

        if (failedServices.length > 0) {
          spinner.stop();
        } else {
          spinner.succeed('Provisioning complete');
        }
        resolve({ data, failedServices, partial: false, serviceStatuses });
      },

      onError: (error) => {
        if (resolved) return;
        resolved = true;

        if (patienceTimerId) clearTimeout(patienceTimerId);

        spinner.fail('Provisioning failed');

        // Only fail spinners that are still running
        serviceSpinners.forEach((s) => s.isSpinning && s.fail());

        // Close the client to clean up timers and sockets
        client.close();

        reject(error);
      },
    });

    client.start();
  });
}

import EventSource from 'eventsource';
import { getApiUrl, getAuthToken } from './config.js';
import { ForjError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Ora } from 'ora';

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp?: string;
}

export interface ServiceEvent {
  service: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SSEClientOptions {
  endpoint: string;
  onEvent?: (event: SSEEvent) => void;
  onServiceUpdate?: (event: ServiceEvent) => void;
  onComplete?: (data: unknown) => void;
  onError?: (error: Error) => void;
}

/**
 * Create SSE client for streaming events from API
 */
export function createSSEClient(options: SSEClientOptions): {
  start: () => void;
  close: () => void;
} {
  const { endpoint, onEvent, onServiceUpdate, onComplete, onError } = options;

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

  function start() {
    eventSource = new EventSource(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Handle incoming messages
    eventSource.onmessage = (event) => {
      try {
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
        if (data.type === 'service_update' && onServiceUpdate) {
          if (data && typeof data.service === 'string' && typeof data.status === 'string') {
            onServiceUpdate(data as ServiceEvent);
          } else {
            logger.warn(`Received malformed 'service_update' event: ${JSON.stringify(data)}`);
          }
        }

        // Handle completion event
        if (data.type === 'complete' && onComplete) {
          onComplete(data.data);
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
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  return { start, close };
}

/**
 * Stream provisioning progress with visual feedback
 */
export async function streamProvisioningProgress(
  endpoint: string,
  spinnerText: string = 'Provisioning...'
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const spinner = logger.spinner(spinnerText);
    const serviceSpinners = new Map<string, Ora>();

    spinner.start();

    const client = createSSEClient({
      endpoint,
      onServiceUpdate: (event) => {
        const { service, status, message, error } = event;

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
            serviceSpinner.start(`${service}: ${message || 'Running'}`);
            break;

          case 'complete':
            serviceSpinner.succeed(`${service}: ${message || 'Complete'}`);
            break;

          case 'failed':
            serviceSpinner.fail(`${service}: ${error || 'Failed'}`);
            break;
        }
      },

      onComplete: (data) => {
        spinner.succeed('Provisioning complete');
        resolve(data);
      },

      onError: (error) => {
        spinner.fail('Provisioning failed');

        // Only fail spinners that are still running
        serviceSpinners.forEach((s) => s.isSpinning && s.fail());

        reject(error);
      },
    });

    client.start();
  });
}

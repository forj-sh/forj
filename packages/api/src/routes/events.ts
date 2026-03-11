import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceEvent, CompleteEvent, ErrorEvent, DomainWorkerEvent, ProvisioningEvent } from '@forj/shared';
import { DomainWorkerEventType } from '@forj/shared';
import { redisPubSub } from '../lib/redis-pubsub.js';

/**
 * Server-Sent Events (SSE) routes for real-time provisioning updates
 *
 * Stack 3: Real SSE streaming from Redis worker events
 *
 * SECURITY NOTE: Authentication not yet implemented.
 * Before production deployment, implement:
 * - Authentication middleware (verify JWT tokens from /auth/cli)
 * - Authorization checks (verify user owns this project via database)
 * - Rate limiting per user to prevent SSE abuse
 * - Input validation for projectId parameter
 */
export async function eventRoutes(server: FastifyInstance) {
  /**
   * GET /events/stream/:projectId
   * SSE endpoint for real-time provisioning events
   *
   * Subscribes to Redis pub/sub channel for worker events and streams them to the CLI.
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   * TODO (SECURITY): Return 404 for non-existent projects (don't leak existence)
   * TODO (SECURITY): Add rate limiting to prevent SSE connection abuse
   */
  server.get<{ Params: { projectId: string } }>(
    '/events/stream/:projectId',
    async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
      const { projectId } = request.params;

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Prevent Fastify from managing the response lifecycle
      reply.hijack();

      // Track stream state to prevent writes after disconnect
      let streamClosed = false;
      let unsubscribe: (() => Promise<void>) | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

      // Helper to send SSE message with fresh timestamp
      const sendEvent = (event: ProvisioningEvent) => {
        if (streamClosed || !reply.raw.writable) {
          return;
        }
        const eventWithTimestamp = {
          ...event,
          timestamp: new Date().toISOString(),
        };
        reply.raw.write(`data: ${JSON.stringify(eventWithTimestamp)}\n\n`);
      };

      // Cleanup function
      const cleanup = async () => {
        if (streamClosed) {
          return;
        }
        streamClosed = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (unsubscribe) {
          await unsubscribe();
          unsubscribe = null;
        }

        if (reply.raw.writable) {
          reply.raw.end();
        }
      };

      request.log.info({ projectId }, 'SSE stream opened');

      // Subscribe to worker events from Redis
      unsubscribe = await redisPubSub.subscribeWorkerEvents(
        projectId,
        (workerEvent: DomainWorkerEvent) => {
          // Convert worker event to SSE event format
          const sseEvent = convertWorkerEventToSSE(workerEvent);

          if (sseEvent) {
            sendEvent(sseEvent);
          }

          // Close stream on completion or failure
          if (
            workerEvent.type === DomainWorkerEventType.JOB_COMPLETED ||
            workerEvent.type === DomainWorkerEventType.JOB_FAILED
          ) {
            request.log.info(
              { projectId, eventType: workerEvent.type },
              'SSE stream closing (job terminal state)'
            );
            cleanup().catch((err) => {
              request.log.error({ err }, 'Error during SSE cleanup');
            });
          }
        }
      );

      if (!unsubscribe) {
        // Redis subscription failed
        request.log.error({ projectId }, 'Failed to subscribe to worker events');
        sendEvent({
          type: 'error',
          error: 'Failed to connect to event stream',
          code: 'REDIS_UNAVAILABLE',
        });
        await cleanup();
        return;
      }

      // Set timeout to prevent zombie streams (5 minutes max)
      timeoutId = setTimeout(() => {
        request.log.warn({ projectId }, 'SSE stream timeout (5 minutes)');
        sendEvent({
          type: 'error',
          error: 'Stream timeout - please check project status',
          code: 'TIMEOUT',
        });
        cleanup().catch((err) => {
          request.log.error({ err }, 'Error during SSE timeout cleanup');
        });
      }, 5 * 60 * 1000);

      // Cleanup on client disconnect
      request.raw.on('close', () => {
        request.log.info({ projectId }, 'SSE stream closed (client disconnect)');
        cleanup().catch((err) => {
          request.log.error({ err }, 'Error during SSE client disconnect cleanup');
        });
      });

      // Send initial connection message
      sendEvent({
        type: 'status',
        status: 'pending',
        message: 'Connected to provisioning stream',
      });
    }
  );
}

/**
 * Convert domain worker event to SSE event format
 *
 * Maps worker-specific events to the CLI's expected ServiceEvent format.
 */
function convertWorkerEventToSSE(
  workerEvent: DomainWorkerEvent
): ProvisioningEvent | null {
  // Map worker event types to SSE events
  switch (workerEvent.type) {
    case DomainWorkerEventType.JOB_CREATED:
    case DomainWorkerEventType.JOB_QUEUED:
      return {
        type: 'status',
        service: 'domain',
        status: 'pending',
        message: 'Domain job queued',
      };

    case DomainWorkerEventType.JOB_STARTED:
      return {
        type: 'status',
        service: 'domain',
        status: 'running',
        message: 'Starting domain provisioning',
      };

    case DomainWorkerEventType.JOB_PROGRESS:
      // Extract progress info from event data
      const progressData = workerEvent.data as { step?: string; progress?: number } | undefined;
      const step = progressData?.step || 'processing';
      const stepMessages: Record<string, string> = {
        checking: 'Checking domain availability...',
        registering: 'Registering domain with Namecheap...',
        configuring: 'Configuring nameservers...',
      };

      return {
        type: 'status',
        service: 'domain',
        status: 'running',
        message: stepMessages[step] || `Domain ${step}...`,
        data: workerEvent.data as Record<string, unknown> | undefined,
      };

    case DomainWorkerEventType.JOB_COMPLETED:
      return {
        type: 'status',
        service: 'domain',
        status: 'complete',
        message: 'Domain provisioned successfully',
        data: workerEvent.data as Record<string, unknown> | undefined,
      };

    case DomainWorkerEventType.JOB_FAILED:
      return {
        type: 'error',
        error: workerEvent.error || 'Domain provisioning failed',
        code: 'DOMAIN_PROVISIONING_FAILED',
      };

    case DomainWorkerEventType.JOB_RETRYING:
      return {
        type: 'status',
        service: 'domain',
        status: 'running',
        message: 'Retrying domain provisioning...',
      };

    default:
      // Unknown event type, log but don't send to client
      return null;
  }
}

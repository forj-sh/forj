import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceEvent, CompleteEvent, ErrorEvent, DomainWorkerEvent, ProvisioningEvent } from '@forj/shared';
import { DomainWorkerEventType } from '@forj/shared';
import { redisPubSub } from '../lib/redis-pubsub.js';
import { requireAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';
import { verifyProjectOwnership } from '../lib/authorization.js';
import { getProjectByIdAndUserId } from '../lib/database.js';

/**
 * Server-Sent Events (SSE) routes for real-time provisioning updates
 *
 * Stack 3: Real SSE streaming from Redis worker events with authentication
 *
 * SECURITY:
 * - Authentication middleware (JWT required)
 * - Authorization checks (user must own project)
 * - IP-based rate limiting (max 10 streams per minute)
 * - Returns 404 for unauthorized projects (prevents enumeration)
 *
 * RELIABILITY TRADE-OFFS:
 * 1. Rate Limiter Fail-Open (ipRateLimit):
 *    - If Redis is unavailable, rate limiting is bypassed (fail-open)
 *    - Trade-off: Availability > DoS protection during Redis outages
 *    - Rationale: SSE streams are authenticated and short-lived (<5min)
 *    - TODO: Consider fail-closed mode for production deployments
 *
 * 2. Authorization Error Handling (verifyProjectOwnership):
 *    - Database errors are swallowed and treated as authorization failures
 *    - Returns 404 for both "not found" and "DB unavailable" cases
 *    - Masks infrastructure problems (DB outages appear as 404s)
 *    - TODO (Stack refactor): Make verifyProjectOwnership throw on DB errors
 *      to allow proper 500 responses for infrastructure failures
 */
export async function eventRoutes(server: FastifyInstance) {
  /**
   * GET /events/stream/:projectId
   * SSE endpoint for real-time provisioning events
   *
   * Subscribes to Redis pub/sub channel for worker events and streams them to the CLI.
   *
   * SECURITY: Stack 3 implementation
   * - requireAuth: Verifies JWT token
   * - verifyProjectOwnership: Ensures user owns the project
   * - ipRateLimit: Max 10 concurrent streams per IP per minute
   * - 404 response for unauthorized access (prevents project ID enumeration)
   */
  server.get<{ Params: { projectId: string }; Querystring: { services?: string } }>(
    '/events/stream/:projectId',
    {
      preHandler: [
        requireAuth,
        // TRADE-OFF: Fail-open rate limiting (bypassed if Redis unavailable)
        // Prioritizes availability over strict DoS protection
        ipRateLimit('sse-stream', { maxRequests: 10, windowMs: 60000 })
      ]
    },
    async (request: FastifyRequest<{ Params: { projectId: string }; Querystring: { services?: string } }>, reply: FastifyReply) => {
      const { projectId } = request.params;
      const requestedServices = request.query.services?.split(',').filter(Boolean);
      const userId = request.user!.userId; // Guaranteed by requireAuth

      // AUTHORIZATION CHECK: Verify user owns this project
      // LIMITATION: verifyProjectOwnership swallows DB errors and returns false
      // This means DB failures appear as 404s instead of 500s (masks infrastructure issues)
      // See TODO in file header for refactoring plan
      const ownsProject = await verifyProjectOwnership(projectId, userId, request.log);
      if (!ownsProject) {
        // Return 404 instead of 403 to prevent project ID enumeration
        // Note: This 404 could mean either "not found" or "DB error" (see limitation above)
        request.log.warn({
          projectId,
          userId,
        }, 'SSE stream blocked - project not found or unauthorized');

        return reply.status(404).send({
          success: false,
          error: 'Project not found',
          code: 'PROJECT_NOT_FOUND',
        });
      }

      request.log.info({
        projectId,
        userId,
      }, 'SSE stream authorized - user owns project');

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

      // Determine expected services for this project to track multi-service completion
      // If ?services= query param is provided, only wait for those specific services
      const expectedServices = new Set<string>();
      const completedServices = new Set<string>();
      if (requestedServices && requestedServices.length > 0) {
        for (const s of requestedServices) {
          expectedServices.add(s);
        }
      } else {
        try {
          const project = await getProjectByIdAndUserId(projectId, userId);
          if (project?.services) {
            for (const [serviceName, serviceState] of Object.entries(project.services)) {
              if (serviceState && serviceState.status !== 'complete') {
                expectedServices.add(serviceName);
              }
            }
          }
        } catch (err) {
          request.log.warn({ err, projectId }, 'Failed to load project services for SSE tracking');
        }
      }

      // Subscribe to worker events from Redis
      unsubscribe = await redisPubSub.subscribeWorkerEvents(
        projectId,
        (workerEvent: any) => {
          // Convert worker event to SSE event format
          const sseEvent = convertWorkerEventToSSE(workerEvent);

          if (sseEvent) {
            sendEvent(sseEvent);
          }

          // Track terminal states per service to know when all are done
          const eventType = workerEvent.type as string;
          const isCompleted = eventType.includes('completed') || eventType === DomainWorkerEventType.JOB_COMPLETED;
          const isFailed = eventType.includes('failed') || eventType === DomainWorkerEventType.JOB_FAILED;

          if (isCompleted || isFailed) {
            const service = detectService(eventType, workerEvent);
            if (service && service !== 'unknown') {
              completedServices.add(service);
            }

            // Check if all expected services have reached terminal state
            const allDone = expectedServices.size === 0 ||
              [...expectedServices].every(s => completedServices.has(s));

            if (allDone) {
              // All services reached terminal state — send complete so CLI exits cleanly
              // Individual service failures are already communicated via per-service status events
              sendEvent({ type: 'complete', data: { projectId } });
              request.log.info(
                { projectId, eventType, completedServices: [...completedServices] },
                'SSE stream closing (all services reached terminal state)'
              );
              cleanup().catch((err) => {
                request.log.error({ err }, 'Error during SSE cleanup');
              });
            } else {
              request.log.info(
                { projectId, eventType, service, completedServices: [...completedServices], expectedServices: [...expectedServices] },
                'Service reached terminal state, waiting for remaining services'
              );
            }
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
 * Convert any worker event to SSE event format
 *
 * Handles domain, GitHub, Cloudflare, and DNS worker events.
 * Maps to the CLI's expected ServiceEvent format.
 */
function convertWorkerEventToSSE(
  workerEvent: any
): ProvisioningEvent | null {
  const eventType = (workerEvent.type as string) || '';

  // Domain worker events (specific handling for progress steps)
  if (eventType === DomainWorkerEventType.JOB_PROGRESS) {
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
    };
  }

  // Detect service from event type or data
  const service = detectService(eventType, workerEvent);

  // Generic event mapping based on event type patterns
  if (eventType.includes('started') || eventType.includes('queued') || eventType.includes('created')) {
    return { type: 'status', service, status: 'running', message: `${service}: Starting...` };
  }

  if (eventType.includes('completed') || eventType.includes('complete') || eventType.includes('verified')) {
    return { type: 'status', service, status: 'complete', message: `${service}: Complete` };
  }

  if (eventType.includes('failed')) {
    return { type: 'status', service, status: 'failed', error: workerEvent.error || `${service} failed` };
  }

  if (eventType.includes('progress') || eventType.includes('running') || eventType.includes('creating') || eventType.includes('verifying')) {
    return { type: 'status', service, status: 'running', message: workerEvent.message || `${service}: In progress...` };
  }

  // Pass through any event with a recognizable structure
  if (service) {
    return { type: 'status', service, status: 'running', message: workerEvent.message || `${service}: Processing...` };
  }

  return null;
}

/**
 * Detect which service a worker event belongs to
 */
function detectService(eventType: string, event: any): any {
  // Check event data for explicit service
  if (event.service) return event.service;

  // Infer from event type naming convention
  const lower = eventType.toLowerCase();
  if (lower.includes('domain') || lower.includes('register') || lower.includes('nameserver')) return 'domain';
  if (lower.includes('github') || lower.includes('repo') || lower.includes('org')) return 'github';
  if (lower.includes('cloudflare') || lower.includes('zone')) return 'cloudflare';
  if (lower.includes('dns') || lower.includes('mx') || lower.includes('spf') || lower.includes('dkim')) return 'dns';

  // Check for domain worker specific types
  if (Object.values(DomainWorkerEventType).includes(eventType as any)) return 'domain';

  return 'unknown';
}

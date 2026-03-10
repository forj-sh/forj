import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServiceEvent, CompleteEvent } from '@forj/shared';

/**
 * Server-Sent Events (SSE) routes for real-time provisioning updates
 *
 * SECURITY NOTE: These are mock endpoints for CLI testing.
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

      // Helper to send SSE message with fresh timestamp
      const sendEvent = (event: ServiceEvent | CompleteEvent) => {
        if (streamClosed || !reply.raw.writable) {
          return;
        }
        const eventWithTimestamp = {
          ...event,
          timestamp: new Date().toISOString(),
        };
        reply.raw.write(`data: ${JSON.stringify(eventWithTimestamp)}\n\n`);
      };

      request.log.info({ projectId }, 'SSE stream opened');

      // Simulate provisioning workflow with realistic timing
      // Note: timestamps are added dynamically by sendEvent()
      const events: (ServiceEvent | CompleteEvent)[] = [
        {
          type: 'status',
          service: 'domain',
          status: 'running',
          message: 'Checking domain availability...',
        },
        {
          type: 'status',
          service: 'domain',
          status: 'running',
          message: 'Registering domain with Namecheap...',
        },
        {
          type: 'status',
          service: 'domain',
          status: 'complete',
          message: 'Domain registered successfully',
          data: { domain: 'getacme.com', registrar: 'Namecheap' },
        },
        {
          type: 'status',
          service: 'github',
          status: 'running',
          message: 'Verifying GitHub organization...',
        },
        {
          type: 'status',
          service: 'github',
          status: 'running',
          message: 'Creating repositories...',
        },
        {
          type: 'status',
          service: 'github',
          status: 'complete',
          message: 'GitHub organization configured',
          data: { org: 'getacme', repos: ['app', 'api'] },
        },
        {
          type: 'status',
          service: 'cloudflare',
          status: 'running',
          message: 'Creating Cloudflare zone...',
        },
        {
          type: 'status',
          service: 'cloudflare',
          status: 'complete',
          message: 'Cloudflare zone active',
          data: { zone: 'getacme.com', nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'] },
        },
        {
          type: 'status',
          service: 'dns',
          status: 'running',
          message: 'Configuring DNS records...',
        },
        {
          type: 'status',
          service: 'dns',
          status: 'running',
          message: 'Adding MX records for email...',
        },
        {
          type: 'status',
          service: 'dns',
          status: 'running',
          message: 'Configuring SPF, DKIM, DMARC...',
        },
        {
          type: 'status',
          service: 'dns',
          status: 'complete',
          message: 'DNS wiring complete',
          data: { records: ['MX', 'SPF', 'DKIM', 'DMARC', 'CNAME'] },
        },
        {
          type: 'complete',
          message: 'Project provisioning complete',
          data: {
            projectId,
            duration: '2m 14s',
            services: ['domain', 'github', 'cloudflare', 'dns'],
          },
        },
      ];

      // Send events with realistic delays
      let index = 0;
      const intervalId = setInterval(() => {
        if (index >= events.length) {
          clearInterval(intervalId);
          reply.raw.end();
          request.log.info({ projectId }, 'SSE stream closed (complete)');
          return;
        }

        sendEvent(events[index]);
        index++;
      }, 1500); // Send event every 1.5 seconds

      // Cleanup on client disconnect
      request.raw.on('close', () => {
        streamClosed = true;
        clearInterval(intervalId);
        request.log.info({ projectId }, 'SSE stream closed (client disconnect)');
      });
    }
  );
}

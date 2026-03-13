/**
 * Provisioning routes
 *
 * POST /provision - Start infrastructure provisioning
 * GET /provision/:jobId - Get provisioning status
 */

import type { FastifyInstance } from 'fastify';
import { ProvisioningOrchestrator, type ProvisioningConfig } from '../lib/orchestrator.js';
import { getDomainQueue, getGitHubQueue, getCloudflareQueue, getDNSQueue } from '../lib/queues.js';
import { getRedis } from '../lib/redis.js';

/**
 * Provisioning routes
 */
export async function provisionRoutes(server: FastifyInstance) {
  /**
   * POST /provision
   * Start infrastructure provisioning
   *
   * Kicks off parallel provisioning of:
   * - Domain registration (Namecheap)
   * - GitHub repository
   * - Cloudflare DNS zone
   * - DNS record wiring
   */
  server.post<{ Body: ProvisioningConfig }>('/provision', async (request, reply) => {
    const config = request.body;

    // Validate required fields
    if (
      !config.userId ||
      !config.projectId ||
      !config.domain ||
      !config.namecheapApiUser ||
      !config.namecheapApiKey ||
      !config.namecheapUsername ||
      !config.githubToken ||
      !config.cloudflareApiToken ||
      !config.cloudflareAccountId ||
      !config.githubOrg ||
      !config.years ||
      !config.contactInfo
    ) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required fields',
        message:
          'Required: userId, projectId, domain, namecheapApiUser, namecheapApiKey, namecheapUsername, githubToken, cloudflareApiToken, cloudflareAccountId, githubOrg, years, contactInfo',
      });
    }

    // Validate contactInfo subfields
    const { contactInfo } = config;
    if (
      !contactInfo.firstName ||
      !contactInfo.lastName ||
      !contactInfo.email ||
      !contactInfo.phone ||
      !contactInfo.address1 ||
      !contactInfo.city ||
      !contactInfo.stateProvince ||
      !contactInfo.postalCode ||
      !contactInfo.country
    ) {
      return reply.status(400).send({
        success: false,
        error: 'Incomplete contact information',
        message:
          'contactInfo requires: firstName, lastName, email, phone, address1, city, stateProvince, postalCode, country',
      });
    }

    try {
      // Initialize orchestrator
      const orchestrator = new ProvisioningOrchestrator(
        getDomainQueue(),
        getGitHubQueue(),
        getCloudflareQueue(),
        getDNSQueue()
      );

      // Start provisioning (fire-and-forget - don't await)
      // CRITICAL: Do NOT await here - provisioning can take 5+ minutes
      // The orchestrator will run in background and publish events via Redis pub/sub
      orchestrator.provision(config).catch((error) => {
        // Log errors but don't block the response
        request.log.error({
          projectId: config.projectId,
          error: error.message,
          stack: error.stack,
        }, 'Background provisioning failed');
      });

      request.log.info({
        projectId: config.projectId,
        userId: config.userId,
        domain: config.domain,
      }, 'Provisioning started (background)');

      return {
        success: true,
        data: {
          projectId: config.projectId,
          message: 'Provisioning started in background. Use /events/stream/:projectId to monitor progress.',
        },
      };
    } catch (error) {
      request.log.error({ error }, 'Provisioning failed to start');

      return reply.status(500).send({
        success: false,
        error: 'Provisioning failed to start',
        message: (error as Error).message,
      });
    }
  });

  /**
   * GET /provision/status/:projectId
   * Get overall provisioning status for a project
   *
   * Returns aggregated status of all provisioning jobs
   *
   * TODO: Implement this endpoint by querying BullMQ job statuses and aggregating them
   */
  server.get<{ Params: { projectId: string } }>(
    '/provision/status/:projectId',
    async (request, reply) => {
      const { projectId } = request.params;

      request.log.info({ projectId }, 'Status endpoint called but not yet implemented');

      return reply.status(501).send({
        success: false,
        error: 'Not Implemented',
        message: 'Status aggregation endpoint not yet implemented. Use /events/stream/:projectId for real-time updates.',
      });
    }
  );
}

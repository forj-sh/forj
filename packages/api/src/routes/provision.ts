/**
 * Provisioning routes
 *
 * POST /provision - Start infrastructure provisioning
 * GET /provision/status/:projectId - Get provisioning status
 *
 * SECURITY: All routes require authentication. Scopes vary by route:
 * - POST /provision requires agent:provision
 * - GET /provision/status/:projectId requires agent:read
 */

import type { FastifyInstance } from 'fastify';
import { ProvisioningOrchestrator, type ProvisioningConfig } from '../lib/orchestrator.js';
import { getDomainQueue, getGitHubQueue, getCloudflareQueue, getDNSQueue } from '../lib/queues.js';
import { requireAuth, requireScopes } from '../middleware/auth.js';
import { API_KEY_SCOPES } from '../lib/api-key-service.js';
import { verifyProjectOwnership } from '../lib/authorization.js';

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
   *
   * AUTHENTICATION: Requires JWT or API key with agent:provision scope
   * SECURITY: userId is extracted from authenticated user, not from request body
   */
  server.post<{ Body: Omit<ProvisioningConfig, 'userId'> }>(
    '/provision',
    {
      preHandler: [requireAuth, requireScopes([API_KEY_SCOPES.AGENT_PROVISION])],
    },
    async (request, reply) => {
      const bodyConfig = request.body;

      // Extract userId from authenticated user (SECURITY: Never trust client-provided userId)
      const userId = request.user?.userId;
      if (!userId) {
        // This should be guaranteed by requireAuth, but we check as a safeguard
        request.log.error('User ID not found on request object after authentication');
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'User ID not found after authentication',
        });
      }

      // Build full config with authenticated userId
      const config: ProvisioningConfig = {
        ...bodyConfig,
        userId, // Use authenticated user's ID
      };

      // Validate required fields
      if (
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
            'Required: projectId, domain, namecheapApiUser, namecheapApiKey, namecheapUsername, githubToken, cloudflareApiToken, cloudflareAccountId, githubOrg, years, contactInfo',
        });
      }

      // Verify project ownership to prevent IDOR
      const ownsProject = await verifyProjectOwnership(config.projectId, userId, request.log);
      if (!ownsProject) {
        request.log.warn({
          projectId: config.projectId,
          userId,
        }, 'User attempted to provision project they do not own');

        return reply.status(404).send({
          success: false,
          error: 'Project not found',
          message: 'The specified project does not exist or you do not have access to it',
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
   * AUTHENTICATION: Requires JWT or API key with agent:read scope
   * TODO: Implement this endpoint by querying BullMQ job statuses and aggregating them
   */
  server.get<{ Params: { projectId: string } }>(
    '/provision/status/:projectId',
    {
      preHandler: [requireAuth, requireScopes([API_KEY_SCOPES.AGENT_READ])],
    },
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

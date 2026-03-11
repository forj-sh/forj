import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import type {
  ProjectInitRequest,
  ProjectInitResponse,
  ProjectStatus,
  AddServiceRequest,
  DNSHealthResult,
  DNSFixResponse,
  DNSRecordType,
  EmailProvider,
} from '@forj/shared';
import { DNSHealthChecker, type ExpectedDNSConfig } from '../lib/dns-health-checker.js';

/**
 * Project routes
 *
 * SECURITY NOTE: These are mock endpoints for CLI testing.
 * Before production deployment, implement:
 * - Authentication middleware (verify JWT tokens from /auth/cli)
 * - Authorization checks (verify user_id ownership via database)
 * - Rate limiting per user
 * - Input sanitization and validation
 */
export async function projectRoutes(server: FastifyInstance) {
  /**
   * POST /projects/init
   * Initialize new project - returns mock project ID
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Validate user_id from JWT and store with project
   * TODO (SECURITY): Check user project quota limits
   */
  server.post<{ Body: ProjectInitRequest }>('/projects/init', async (request, reply) => {
    const { name, domain, services, githubOrg } = request.body;

    if (!name || !domain || !services || services.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required fields: name, domain, services',
      });
    }

    // Generate cryptographically secure project ID
    const projectId = `proj_${randomUUID()}`;

    request.log.info({
      projectId,
      name,
      domain,
      services,
      githubOrg,
    }, 'Project initialization');

    const response: ProjectInitResponse = {
      projectId,
    };

    return {
      success: true,
      data: response,
    };
  });

  /**
   * GET /projects/:id/status
   * Get project status - returns mock project state
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   * TODO (SECURITY): Return 404 for non-existent projects (don't leak existence)
   */
  server.get<{ Params: { id: string } }>('/projects/:id/status', async (request, reply) => {
    const { id } = request.params;

    // Mock project status
    const status: ProjectStatus = {
      project: 'demo-project',
      domain: 'getdemo.com',
      services: {
        domain: {
          status: 'active',
          value: 'getdemo.com',
          detail: 'Registered via Namecheap',
          updatedAt: new Date(Date.now() - 3600000).toISOString(),
        },
        github: {
          status: 'active',
          value: 'github.com/demo-org',
          detail: 'Organization configured',
          updatedAt: new Date(Date.now() - 3000000).toISOString(),
        },
        cloudflare: {
          status: 'active',
          value: 'Zone active',
          detail: 'DNS configured',
          updatedAt: new Date(Date.now() - 2400000).toISOString(),
        },
        dns: {
          status: 'active',
          value: 'All records healthy',
          updatedAt: new Date(Date.now() - 1800000).toISOString(),
        },
      },
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
    };

    request.log.info({ projectId: id }, 'Project status check');

    return {
      success: true,
      data: status,
    };
  });

  /**
   * POST /projects/:id/services
   * Add service to project - returns success
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   * TODO (SECURITY): Validate service type against allowed values
   */
  server.post<{ Params: { id: string }; Body: AddServiceRequest }>(
    '/projects/:id/services',
    async (request, reply) => {
      const { id } = request.params;
      const { service } = request.body;

      if (!service) {
        return reply.status(400).send({
          success: false,
          error: 'Service name is required',
        });
      }

      request.log.info({
        projectId: id,
        service,
      }, 'Add service to project');

      // Use consistent ApiResponse structure (message at top-level)
      return {
        success: true,
        message: `Service '${service}' queued for provisioning`,
      };
    }
  );

  /**
   * GET /projects/:id/dns/health
   * Check DNS health - verifies DNS records are properly configured
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   * TODO: Fetch project configuration from database instead of using mock data
   */
  server.get<{ Params: { id: string }; Querystring: { domain: string; zoneId: string } }>(
    '/projects/:id/dns/health',
    async (request, reply) => {
      const { id } = request.params;
      const { domain, zoneId } = request.query;

      // TODO: Fetch from database once project storage is implemented
      // For now, require domain and zoneId as query params for testing
      if (!domain || !zoneId) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required query parameters: domain, zoneId',
          message:
            'Query params required until project database integration is complete. Example: ?domain=example.com&zoneId=abc123',
        });
      }

      const config: ExpectedDNSConfig = {
        domain,
        zoneId,
        // TODO: Pull from database - this is a mock value
        emailProvider: 'GOOGLE_WORKSPACE' as EmailProvider,
      };

      try {
        const checker = new DNSHealthChecker();

        const health = await checker.checkHealth(config);

        request.log.info(
          {
            projectId: id,
            domain,
            overall: health.overall,
            recordCount: health.records.length,
          },
          'DNS health check'
        );

        return {
          success: true,
          data: health,
        };
      } catch (error) {
        request.log.error({ projectId: id, error }, 'DNS health check failed');

        return reply.status(500).send({
          success: false,
          error: 'DNS health check failed',
        });
      }
    }
  );

  /**
   * POST /projects/:id/dns/fix
   * Auto-repair DNS issues by recreating missing/invalid records
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   * TODO (SECURITY): Rate limit DNS fix operations to prevent abuse
   * TODO: Fetch project configuration and API token from database
   */
  server.post<{
    Params: { id: string };
    Body: { domain: string; zoneId: string; cloudflareApiToken: string; recordTypes?: DNSRecordType[] };
  }>('/projects/:id/dns/fix', async (request, reply) => {
    const { id } = request.params;
    const { domain, zoneId, cloudflareApiToken, recordTypes } = request.body;

    // TODO: Fetch from database once project storage is implemented
    // For now, require domain, zoneId, and cloudflareApiToken in request body for testing
    if (!domain || !zoneId || !cloudflareApiToken) {
      return reply.status(400).send({
        success: false,
        error: 'Missing required fields: domain, zoneId, cloudflareApiToken',
        message:
          'These fields required until project database integration is complete. Example: {"domain":"example.com","zoneId":"abc123","cloudflareApiToken":"xxx"}',
      });
    }

    const config: ExpectedDNSConfig = {
      domain,
      zoneId,
      // TODO: Pull from database - this is a mock value
      emailProvider: 'GOOGLE_WORKSPACE' as EmailProvider,
    };

    try {
      const checker = new DNSHealthChecker();

      const result = await checker.autoRepair(config, cloudflareApiToken, recordTypes);

      request.log.info(
        {
          projectId: id,
          domain,
          fixed: result.fixed.length,
          failed: result.failed.length,
        },
        'DNS auto-repair complete'
      );

      const message =
        result.fixed.length === 0 && result.failed.length === 0
          ? 'No DNS issues found to fix'
          : `Fixed ${result.fixed.length} record(s), ${result.failed.length} failed`;

      return {
        success: true,
        data: result,
        message,
      };
    } catch (error) {
      request.log.error({ projectId: id, error }, 'DNS auto-repair failed');

      return reply.status(500).send({
        success: false,
        error: 'DNS auto-repair failed',
      });
    }
  });
}

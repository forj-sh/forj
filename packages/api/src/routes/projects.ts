import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import type {
  ProjectInitRequest,
  ProjectInitResponse,
  ProjectStatus,
  AddServiceRequest,
  DNSHealthResult,
  DNSFixResponse,
} from '@forj/shared';

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
   * Check DNS health - returns mock DNS status
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   */
  server.get<{ Params: { id: string } }>('/projects/:id/dns/health', async (request, reply) => {
    const { id } = request.params;

    const health: DNSHealthResult = {
      domain: 'getdemo.com',
      overall: 'healthy',
      records: [
        {
          type: 'MX',
          name: '@',
          value: 'aspmx.l.google.com',
          status: 'valid',
        },
        {
          type: 'TXT',
          name: '@',
          value: 'v=spf1 include:_spf.google.com ~all',
          status: 'valid',
        },
        {
          type: 'TXT',
          name: '_dmarc',
          value: 'v=DMARC1; p=none; rua=mailto:dmarc@getdemo.com',
          status: 'valid',
        },
        {
          type: 'CNAME',
          name: 'www',
          value: 'getdemo.com',
          status: 'valid',
        },
      ],
      checkedAt: new Date().toISOString(),
    };

    request.log.info({ projectId: id }, 'DNS health check');

    return {
      success: true,
      data: health,
    };
  });

  /**
   * POST /projects/:id/dns/fix
   * Fix DNS issues - returns mock fix results
   *
   * TODO (SECURITY): Add authentication middleware before production
   * TODO (SECURITY): Verify user owns this project (check user_id in database)
   * TODO (SECURITY): Rate limit DNS fix operations to prevent abuse
   */
  server.post<{ Params: { id: string } }>('/projects/:id/dns/fix', async (request, reply) => {
    const { id } = request.params;

    // Mock fix results
    const result: DNSFixResponse = {
      fixed: [],
      failed: [],
    };

    request.log.info({ projectId: id }, 'DNS fix attempt');

    return {
      success: true,
      data: result,
      message: 'No DNS issues found to fix',
    };
  });
}

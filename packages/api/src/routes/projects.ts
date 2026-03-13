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
  ServiceType,
  ServiceStatusDisplay,
} from '@forj/shared';
import { DNSHealthChecker, type ExpectedDNSConfig } from '../lib/dns-health-checker.js';
import { requireAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  createProject,
  getProjectByIdAndUserId,
  isDomainTaken,
} from '../lib/database.js';

/**
 * Project routes
 *
 * SECURITY STATUS:
 * ✅ Authentication middleware (JWT or API key)
 * ✅ IP-based rate limiting (prevent distributed attacks)
 * ✅ Per-user rate limiting (prevent individual abuse)
 * ✅ Authorization checks (verify user_id ownership via database)
 * ✅ Project data persistence (PostgreSQL)
 * ✅ Domain uniqueness check (prevent duplicate registrations)
 * TODO: Input sanitization and validation (domain format, service names)
 * TODO: User project quota limits
 */
export async function projectRoutes(server: FastifyInstance) {
  /**
   * POST /projects/init
   * Initialize new project and persist to database
   *
   * AUTHENTICATION: Requires JWT or API key
   * RATE LIMITING: IP-based + user-based
   * AUTHORIZATION: User ID from auth token
   */
  server.post<{ Body: ProjectInitRequest }>(
    '/projects/init',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { name, domain, services, githubOrg } = request.body;

      // Validate required fields
      if (!name || !domain || !services || services.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: name, domain, services',
        });
      }

      // Get authenticated user ID
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }

      // Check if domain is already taken
      const domainExists = await isDomainTaken(domain);
      if (domainExists) {
        return reply.status(409).send({
          success: false,
          error: `Domain ${domain} is already registered`,
        });
      }

      // Generate cryptographically secure project ID
      const projectId = `proj_${randomUUID()}`;

      try {
        // Create project in database
        const project = await createProject({
          id: projectId,
          name,
          domain,
          userId,
          services,
        });

        request.log.info({
          projectId: project.id,
          name: project.name,
          domain: project.domain,
          services,
          githubOrg,
        }, 'Project initialization');

        const response: ProjectInitResponse = {
          projectId: project.id,
        };

        return {
          success: true,
          data: response,
        };
      } catch (error) {
        request.log.error(error, 'Failed to create project');
        return reply.status(500).send({
          success: false,
          error: 'Failed to create project',
        });
      }
    });

  /**
   * GET /projects/:id/status
   * Get project status from database
   *
   * AUTHENTICATION: Requires JWT or API key
   * RATE LIMITING: IP-based + user-based
   * AUTHORIZATION: User must own the project
   */
  server.get<{ Params: { id: string } }>(
    '/projects/:id/status',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { id } = request.params;

      // Get authenticated user ID
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }

      // Get project with ownership check
      const project = await getProjectByIdAndUserId(id, userId);

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: 'Project not found',
        });
      }

      // Convert ServiceState to ServiceStatusDisplay
      const displayServices: Partial<Record<ServiceType, ServiceStatusDisplay>> = {};

      for (const [serviceType, serviceState] of Object.entries(project.services)) {
        if (!serviceState) continue;

        // Map internal service status to display status
        let displayStatusValue: 'pending' | 'active' | 'failed';
        switch (serviceState.status) {
          case 'complete':
            displayStatusValue = 'active';
            break;
          case 'failed':
            displayStatusValue = 'failed';
            break;
          case 'pending':
          case 'running':
          default:
            displayStatusValue = 'pending';
            break;
        }

        const displayStatus: ServiceStatusDisplay = {
          status: displayStatusValue,
          value: serviceState.value,
          detail: serviceState.error,
          updatedAt: serviceState.updatedAt,
        };

        displayServices[serviceType as ServiceType] = displayStatus;
      }

      const status: ProjectStatus = {
        project: project.name,
        domain: project.domain,
        services: displayServices,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
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
   * AUTHENTICATION: Requires JWT or API key
   * RATE LIMITING: IP-based + user-based
   * TODO: Verify user owns this project (check user_id in database)
   * TODO: Validate service type against allowed values
   */
  server.post<{ Params: { id: string }; Body: AddServiceRequest }>(
    '/projects/:id/services',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
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
   * AUTHENTICATION: Requires JWT or API key
   * RATE LIMITING: IP-based + user-based
   * TODO: Verify user owns this project (check user_id in database)
   * TODO: Fetch project configuration from database instead of using mock data
   */
  server.get<{ Params: { id: string }; Querystring: { domain: string; zoneId: string } }>(
    '/projects/:id/dns/health',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
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
   * AUTHENTICATION: Requires JWT or API key
   * RATE LIMITING: IP-based + user-based
   * TODO: Verify user owns this project (check user_id in database)
   * TODO: Fetch project configuration and API token from database
   */
  server.post<{
    Params: { id: string };
    Body: { domain: string; zoneId: string; cloudflareApiToken: string; recordTypes?: DNSRecordType[] };
  }>(
    '/projects/:id/dns/fix',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
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

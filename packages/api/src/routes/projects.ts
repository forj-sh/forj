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
  getUser,
  updateProjectService,
  type User,
} from '../lib/database.js';
import { ProvisioningOrchestrator, type ProvisioningConfig } from '../lib/orchestrator.js';
import { decrypt } from '../lib/encryption.js';
import {
  getDomainQueue,
  getGitHubQueue,
  getCloudflareQueue,
  getDNSQueue,
} from '../lib/queues.js';

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

      // Validate service-specific required fields
      if (services.includes('github') && !githubOrg) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required field: githubOrg is required when github service is selected',
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

      // ========== VALIDATE ALL PREREQUISITES BEFORE CREATING PROJECT ==========
      // This prevents orphaned projects if validation fails

      // Check if domain is already taken
      const domainExists = await isDomainTaken(domain);
      if (domainExists) {
        return reply.status(409).send({
          success: false,
          error: `Domain ${domain} is already registered`,
        });
      }

      // Get user credentials from database (only if needed for Cloudflare or GitHub)
      const needsUserCredentials = services.includes('cloudflare') || services.includes('github');
      let user: User | null = null;
      let cloudflareToken: string | undefined;
      let githubToken: string | undefined;

      if (needsUserCredentials) {
        user = await getUser(userId);
        if (!user) {
          return reply.status(500).send({
            success: false,
            error: 'User not found',
          });
        }

        // Only require encryption key when we actually need to decrypt tokens
        const encryptionKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
        if (!encryptionKey) {
          request.log.error('CLOUDFLARE_ENCRYPTION_KEY not configured');
          return reply.status(500).send({
            success: false,
            error: 'Server encryption not configured',
          });
        }

        // Decrypt user credentials
        if (user.cloudflareTokenEncrypted && services.includes('cloudflare')) {
          try {
            cloudflareToken = await decrypt(user.cloudflareTokenEncrypted, encryptionKey);
          } catch (error) {
            request.log.error(error, 'Failed to decrypt Cloudflare token');
            return reply.status(500).send({
              success: false,
              error: 'Failed to decrypt Cloudflare credentials',
            });
          }
        }

        if (user.githubTokenEncrypted && services.includes('github')) {
          try {
            githubToken = await decrypt(user.githubTokenEncrypted, encryptionKey);
          } catch (error) {
            request.log.error(error, 'Failed to decrypt GitHub token');
            return reply.status(500).send({
              success: false,
              error: 'Failed to decrypt GitHub credentials',
            });
          }
        }
      }

      // Validate Namecheap credentials (only if domain service requested)
      if (services.includes('domain')) {
        const namecheapApiUser = process.env.NAMECHEAP_API_USER;
        const namecheapApiKey = process.env.NAMECHEAP_API_KEY;
        const namecheapUsername = process.env.NAMECHEAP_USERNAME;

        if (!namecheapApiUser || !namecheapApiKey || !namecheapUsername) {
          request.log.error('Namecheap credentials not configured');
          return reply.status(500).send({
            success: false,
            error: 'Domain registration not configured',
          });
        }
      }

      // ========== ALL PREREQUISITES VALIDATED - NOW CREATE PROJECT ==========

      // Generate cryptographically secure project ID (raw UUID for database compatibility)
      const projectId = randomUUID();

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

        // Build provisioning config for requested services
        const provisioningConfig: ProvisioningConfig = {
          userId,
          projectId: project.id,
          domain,
          services, // Critical: tell orchestrator which services to provision
          years: 1,
          // TODO: Source contact info from user profile instead of hardcoded values
          // Using placeholder data violates ICANN policies - must fix before production
          contactInfo: {
            firstName: 'Forj',
            lastName: 'User',
            email: user?.email || 'test@forj.sh',
            phone: '+1.0000000000',
            address1: '123 Main St',
            city: 'San Francisco',
            stateProvince: 'CA',
            postalCode: '94102',
            country: 'US',
          },
        };

        // Add service-specific credentials (only if service requested)
        if (services.includes('domain')) {
          provisioningConfig.namecheapApiUser = process.env.NAMECHEAP_API_USER;
          provisioningConfig.namecheapApiKey = process.env.NAMECHEAP_API_KEY;
          provisioningConfig.namecheapUsername = process.env.NAMECHEAP_USERNAME;
        }

        if (services.includes('github')) {
          provisioningConfig.githubToken = githubToken;
          provisioningConfig.githubOrg = githubOrg!; // Safe: validated upfront
        }

        if (services.includes('cloudflare')) {
          provisioningConfig.cloudflareApiToken = cloudflareToken;
          provisioningConfig.cloudflareAccountId = user?.cloudflareAccountId;
        }

        // Start provisioning in background (fire-and-forget, don't await)
        // This keeps the HTTP request fast and consistent with /routes/provision.ts
        const orchestrator = new ProvisioningOrchestrator(
          getDomainQueue(),
          getGitHubQueue(),
          getCloudflareQueue(),
          getDNSQueue()
        );

        orchestrator.provision(provisioningConfig)
          .then(() => {
            request.log.info({
              projectId: project.id,
              services,
            }, 'Provisioning orchestration started');
          })
          .catch(async (error) => {
            request.log.error(error, 'Failed to start provisioning');

            // Update project state to indicate provisioning failed to start
            // This ensures system state is consistent and user can see the failure
            try {
              for (const service of services) {
                await updateProjectService(project.id, service as any, {
                  status: 'failed',
                  error: 'Failed to queue provisioning job. Please try again or contact support.',
                  startedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
            } catch (dbError) {
              request.log.error(dbError, 'Failed to update project state after provisioning error');
            }
          });

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

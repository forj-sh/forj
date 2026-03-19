import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import {
  EmailProvider,
  validateRegistrantContact,
  PHASE1_ONLY_SERVICES,
  STRIPE_PAYMENT_STATUS,
  isValidDomain,
  type ProjectCreateRequest,
  type ProjectCreateResponse,
  type ProjectInitRequest,
  type ProjectInitResponse,
  type ProjectStatus,
  type AddServicesRequest,
  type AddServicesResponse,
  type AddServiceRequest,
  type ContactInfoRequest,
  type RegistrantContact,
  type DNSHealthResult,
  type DNSFixResponse,
  type DNSRecordType,
  type ServiceType,
  type ServiceStatusDisplay,
} from '@forj/shared';
import { DNSHealthChecker, type ExpectedDNSConfig } from '../lib/dns-health-checker.js';
import { getCloudflareToken } from './auth-cloudflare.js';
import { requireAuth } from '../middleware/auth.js';
import { ipRateLimit } from '../middleware/ip-rate-limit.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  createProject,
  createDomainProject,
  getProjectByIdAndUserId,
  isDomainTaken,
  getUser,
  updateProjectService,
  updateProjectContactInfo,
  getProjectContactInfo,
  updateProjectStripeSession,
  updateProjectPaymentStatus,
  updateProjectPhase,
  addProjectServices,
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
  // ══════════════════════════════════════════════════════════════
  // Phase 1: Domain purchase endpoints
  // ══════════════════════════════════════════════════════════════

  /**
   * POST /projects/create
   * Create project for domain purchase (Phase 1)
   *
   * Creates a project with only 'domain' service in pending state.
   * Does NOT start provisioning — that happens after payment via webhook.
   */
  server.post<{ Body: ProjectCreateRequest }>(
    '/projects/create',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { name, domain } = request.body;

      if (!name || !domain) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: name, domain',
        });
      }

      // Validate domain format (shared regex from @forj/shared)
      if (!isValidDomain(domain)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid domain name format',
        });
      }

      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }

      // Check domain uniqueness
      const domainExists = await isDomainTaken(domain);
      if (domainExists) {
        return reply.status(409).send({
          success: false,
          error: `Domain ${domain} is already registered in Forj`,
        });
      }

      const projectId = randomUUID();

      try {
        const project = await createDomainProject({
          id: projectId,
          name,
          domain,
          userId,
        });

        request.log.info(
          { projectId: project.id, name, domain },
          'Project created (Phase 1: domain purchase)'
        );

        const response: ProjectCreateResponse = { projectId: project.id };
        return { success: true, data: response };
      } catch (error) {
        request.log.error(error, 'Failed to create project');
        return reply.status(500).send({
          success: false,
          error: 'Failed to create project',
        });
      }
    }
  );

  /**
   * POST /projects/:id/contact-info
   * Store ICANN-required contact info for domain registration
   *
   * Must be called before Stripe checkout. The webhook handler reads
   * this data when creating the domain registration job.
   */
  server.post<{ Params: { id: string }; Body: ContactInfoRequest }>(
    '/projects/:id/contact-info',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }

      const { contact, useWhoisPrivacy } = request.body;

      // Validate required ICANN fields
      if (!contact || !validateRegistrantContact(contact)) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required contact fields: firstName, lastName, email, phone, address1, city, stateProvince, postalCode, country',
        });
      }

      // Ownership check
      const project = await getProjectByIdAndUserId(id, userId);
      if (!project) {
        return reply.status(404).send({
          success: false,
          error: 'Project not found',
        });
      }

      try {
        await updateProjectContactInfo(id, contact, useWhoisPrivacy ?? true);

        request.log.info({ projectId: id }, 'Contact info stored');
        return { success: true, data: { message: 'Contact info saved' } };
      } catch (error) {
        request.log.error(error, 'Failed to store contact info');
        return reply.status(500).send({
          success: false,
          error: 'Failed to store contact info',
        });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════
  // Phase 2: Service provisioning endpoints
  // ══════════════════════════════════════════════════════════════

  /**
   * POST /projects/:id/provision-services
   * Add services to an existing project and start provisioning (Phase 2)
   *
   * Prerequisites:
   * - Project must exist and belong to user
   * - Domain service must be in 'complete' state (payment confirmed, domain registered)
   * - Required credentials must be stored (GitHub token, Cloudflare token)
   */
  server.post<{ Params: { id: string }; Body: AddServicesRequest }>(
    '/projects/:id/provision-services',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }

      const { services, githubOrg } = request.body;

      if (!services || services.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'At least one service is required',
        });
      }

      // Block Phase 1 services from being added in Phase 2
      const blockedServices = services.filter((s: ServiceType) =>
        PHASE1_ONLY_SERVICES.includes(s)
      );
      if (blockedServices.length > 0) {
        return reply.status(400).send({
          success: false,
          error: `Cannot add Phase 1 services in this endpoint: ${blockedServices.join(', ')}. Domain is already registered.`,
        });
      }

      // DNS requires a Cloudflare zone — auto-include cloudflare if dns is requested
      if (services.includes('dns') && !services.includes('cloudflare')) {
        services.push('cloudflare' as ServiceType);
      }

      if (services.includes('github') && !githubOrg) {
        return reply.status(400).send({
          success: false,
          error: 'githubOrg is required when github service is selected',
        });
      }

      // Ownership check
      const project = await getProjectByIdAndUserId(id, userId);
      if (!project) {
        return reply.status(404).send({
          success: false,
          error: 'Project not found',
        });
      }

      // Verify domain is registered before allowing service provisioning
      const domainState = project.services?.domain;
      if (!domainState || domainState.status !== 'complete') {
        return reply.status(400).send({
          success: false,
          error: 'Domain must be registered before provisioning other services',
        });
      }

      // Get user credentials
      const user = await getUser(userId);
      if (!user) {
        return reply.status(500).send({
          success: false,
          error: 'User not found',
        });
      }

      let cloudflareToken: string | undefined;
      let githubToken: string | undefined;

      if (services.includes('cloudflare') || services.includes('dns')) {
        if (!user.cloudflareTokenEncrypted) {
          return reply.status(400).send({
            success: false,
            error: 'Cloudflare token not found — connect Cloudflare first',
          });
        }
        const cfKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
        if (!cfKey) {
          return reply.status(500).send({ success: false, error: 'Server encryption not configured' });
        }
        try {
          cloudflareToken = await decrypt(user.cloudflareTokenEncrypted, cfKey);
        } catch (error) {
          request.log.error(error, 'Failed to decrypt Cloudflare token');
          return reply.status(500).send({ success: false, error: 'Failed to decrypt Cloudflare credentials' });
        }
      }

      if (services.includes('github')) {
        if (!user.githubTokenEncrypted) {
          return reply.status(400).send({
            success: false,
            error: 'GitHub token not found — authenticate with GitHub first',
          });
        }
        const ghKey = process.env.GITHUB_ENCRYPTION_KEY;
        if (!ghKey) {
          return reply.status(500).send({ success: false, error: 'Server encryption not configured' });
        }
        try {
          githubToken = await decrypt(user.githubTokenEncrypted, ghKey);
        } catch (error) {
          request.log.error(error, 'Failed to decrypt GitHub token');
          return reply.status(500).send({ success: false, error: 'Failed to decrypt GitHub credentials' });
        }
      }

      try {
        // Add services to project in database
        await addProjectServices(id, services);

        // Build provisioning config (domain excluded — already registered)
        const provisioningConfig: ProvisioningConfig = {
          userId,
          projectId: id,
          domain: project.domain,
          services, // Only the new services (github, cloudflare, dns)
          githubOrg: githubOrg || '',
          years: 1,
          // contactInfo omitted — not needed for Phase 2 (GitHub, Cloudflare, DNS)
        };

        if (services.includes('github')) {
          provisioningConfig.githubToken = githubToken;
          provisioningConfig.githubOrg = githubOrg!;
        }

        if (services.includes('cloudflare') || services.includes('dns')) {
          provisioningConfig.cloudflareApiToken = cloudflareToken;
          provisioningConfig.cloudflareAccountId = user.cloudflareAccountId ?? undefined;
        }

        // Start provisioning in background
        const orchestrator = new ProvisioningOrchestrator(
          getDomainQueue(),
          getGitHubQueue(),
          getCloudflareQueue(),
          getDNSQueue()
        );

        orchestrator.provision(provisioningConfig)
          .then(() => {
            request.log.info({ projectId: id, services }, 'Phase 2 provisioning started');
          })
          .catch(async (error) => {
            request.log.error(error, 'Failed to start Phase 2 provisioning');
            try {
              for (const service of services) {
                await updateProjectService(id, service as any, {
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

        const response: AddServicesResponse = { projectId: id };
        return { success: true, data: response };
      } catch (error) {
        request.log.error(error, 'Failed to add services');
        return reply.status(500).send({
          success: false,
          error: 'Failed to add services to project',
        });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════
  // Dev-only endpoints
  // ══════════════════════════════════════════════════════════════

  /**
   * POST /projects/:id/dev/trigger-domain-registration
   * Dev-only: skip Stripe payment and trigger domain registration directly.
   * Only available when NODE_ENV !== 'production'.
   */
  if (process.env.NODE_ENV !== 'production') {
    server.post<{ Params: { id: string } }>(
      '/projects/:id/dev/trigger-domain-registration',
      { preHandler: [requireAuth] },
      async (request, reply) => {
        const { id } = request.params;
        const userId = request.user?.userId;
        if (!userId) {
          return reply.status(500).send({ success: false, error: 'User ID not found' });
        }

        const project = await getProjectByIdAndUserId(id, userId);
        if (!project) {
          return reply.status(404).send({ success: false, error: 'Project not found' });
        }

        const contactData = await getProjectContactInfo(id);
        if (!contactData) {
          return reply.status(400).send({ success: false, error: 'Contact info not stored yet' });
        }

        // Mark payment as paid and start domain registration via orchestrator
        await updateProjectPaymentStatus(id, STRIPE_PAYMENT_STATUS.PAID);

        const provisioningConfig: ProvisioningConfig = {
          userId,
          projectId: id,
          domain: project.domain,
          services: ['domain'],
          githubOrg: '',
          years: 1,
          contactInfo: {
            firstName: contactData.contact.firstName,
            lastName: contactData.contact.lastName,
            email: contactData.contact.email,
            phone: contactData.contact.phone,
            address1: contactData.contact.address1,
            city: contactData.contact.city,
            stateProvince: contactData.contact.stateProvince,
            postalCode: contactData.contact.postalCode,
            country: contactData.contact.country,
          },
          namecheapApiUser: process.env.NAMECHEAP_API_USER,
          namecheapApiKey: process.env.NAMECHEAP_API_KEY,
          namecheapUsername: process.env.NAMECHEAP_USERNAME,
        };

        const orchestrator = new ProvisioningOrchestrator(
          getDomainQueue(), getGitHubQueue(), getCloudflareQueue(), getDNSQueue()
        );

        orchestrator.provision(provisioningConfig).catch((error) => {
          request.log.error(error, 'Dev domain registration failed');
        });

        request.log.warn({ projectId: id }, 'DEV: triggered domain registration without payment');
        return { success: true, data: { message: 'Domain registration triggered (dev mode)' } };
      }
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Legacy endpoints (deprecated — kept for backward compatibility)
  // ══════════════════════════════════════════════════════════════

  /**
   * POST /projects/init
   * @deprecated Use POST /projects/create + POST /projects/:id/provision-services
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

        // Decrypt user credentials using service-specific encryption keys
        if (user.cloudflareTokenEncrypted && services.includes('cloudflare')) {
          const cfKey = process.env.CLOUDFLARE_ENCRYPTION_KEY;
          if (!cfKey) {
            request.log.error('CLOUDFLARE_ENCRYPTION_KEY not configured');
            return reply.status(500).send({ success: false, error: 'Server encryption not configured' });
          }
          try {
            cloudflareToken = await decrypt(user.cloudflareTokenEncrypted, cfKey);
          } catch (error) {
            request.log.error(error, 'Failed to decrypt Cloudflare token');
            return reply.status(500).send({ success: false, error: 'Failed to decrypt Cloudflare credentials' });
          }
        }

        if (user.githubTokenEncrypted && services.includes('github')) {
          const ghKey = process.env.GITHUB_ENCRYPTION_KEY;
          if (!ghKey) {
            request.log.error('GITHUB_ENCRYPTION_KEY not configured');
            return reply.status(500).send({ success: false, error: 'Server encryption not configured' });
          }
          try {
            githubToken = await decrypt(user.githubTokenEncrypted, ghKey);
          } catch (error) {
            request.log.error(error, 'Failed to decrypt GitHub token');
            return reply.status(500).send({ success: false, error: 'Failed to decrypt GitHub credentials' });
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
          githubOrg: githubOrg || '', // Will be set conditionally below if github service requested
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
          provisioningConfig.cloudflareAccountId = user?.cloudflareAccountId ?? undefined;
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
   * @deprecated Use POST /projects/:id/provision-services instead
   */
  server.post<{ Params: { id: string }; Body: AddServiceRequest }>(
    '/projects/:id/services',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }
      const { service } = request.body;

      if (!service) {
        return reply.status(400).send({
          success: false,
          error: 'Service name is required',
        });
      }

      const project = await getProjectByIdAndUserId(id, userId);
      if (!project) {
        return reply.status(404).send({
          success: false,
          error: 'Project not found',
        });
      }

      request.log.warn(
        { projectId: id, service },
        'Deprecated: POST /projects/:id/services — use POST /projects/:id/provision-services'
      );

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
   * AUTHORIZATION: Verify user owns this project
   * RATE LIMITING: IP-based + user-based
   */
  server.get<{ Params: { id: string } }>(
    '/projects/:id/dns/health',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }

      const project = await getProjectByIdAndUserId(id, userId);
      if (!project) {
        return reply.status(404).send({
          success: false,
          error: 'Project not found',
        });
      }

      const domain = project.domain;
      const zoneId = project.services?.cloudflare?.value;

      if (!domain || !zoneId) {
        return reply.status(400).send({
          success: false,
          error: 'Cloudflare DNS not provisioned for this project',
        });
      }

      const config: ExpectedDNSConfig = {
        domain,
        zoneId,
        emailProvider: (project.services?.dns?.meta?.emailProvider as EmailProvider) ?? EmailProvider.GOOGLE_WORKSPACE,
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
   * AUTHORIZATION: Verify user owns this project
   * RATE LIMITING: IP-based + user-based
   *
   * Cloudflare API token is fetched from encrypted storage, never from request body.
   */
  server.post<{
    Params: { id: string };
    Body: { recordTypes?: DNSRecordType[] };
  }>(
    '/projects/:id/dns/fix',
    { preHandler: [requireAuth, ipRateLimit('projects'), rateLimit('projects')] },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(500).send({
          success: false,
          error: 'User ID not found after authentication',
        });
      }
      const { recordTypes } = request.body || {};

      const project = await getProjectByIdAndUserId(id, userId);
      if (!project) {
        return reply.status(404).send({
          success: false,
          error: 'Project not found',
        });
      }

      const domain = project.domain;
      const zoneId = project.services?.cloudflare?.value;

      if (!domain || !zoneId) {
        return reply.status(400).send({
          success: false,
          error: 'Cloudflare DNS not provisioned for this project',
        });
      }

      let cloudflareApiToken: string | null;
      try {
        cloudflareApiToken = await getCloudflareToken(userId);
      } catch (error) {
        request.log.error({ error, projectId: id }, 'Failed to decrypt Cloudflare token');
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve Cloudflare credentials',
        });
      }
      if (!cloudflareApiToken) {
        return reply.status(400).send({
          success: false,
          error: 'No Cloudflare API token found — connect Cloudflare first',
        });
      }

      const config: ExpectedDNSConfig = {
        domain,
        zoneId,
        emailProvider: (project.services?.dns?.meta?.emailProvider as EmailProvider) ?? EmailProvider.GOOGLE_WORKSPACE,
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

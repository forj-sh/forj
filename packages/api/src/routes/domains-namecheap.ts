/**
 * Domain routes with Namecheap integration
 *
 * Reference: project-docs/namecheap-integration-spec.md
 *
 * INTEGRATION STATUS:
 * These routes are defined but NOT YET REGISTERED with the Fastify server.
 * They will be integrated in Stack 12 when the API server is configured with:
 * - NamecheapClient initialization
 * - Domain job queue setup
 * - PricingCache initialization with Redis and logger
 * - Route registration in server.ts
 *
 * SECURITY NOTE:
 * These routes handle domain registration (financial operations) and expose
 * sensitive PII in job payloads. Authentication, authorization, and rate limiting
 * are CRITICAL before production deployment.
 */

import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import {
  splitDomain,
  type NamecheapClient,
  type RegisterDomainJobData,
  type DomainOperationType,
  type DomainJobStatus,
} from '@forj/shared';
import { PricingCache } from '../lib/pricing-cache.js';

/**
 * Enhanced domain routes with real Namecheap integration
 */
export async function domainNamecheapRoutes(
  server: FastifyInstance,
  namecheapClient: NamecheapClient,
  domainQueue: Queue,
  pricingCache: PricingCache
) {
  /**
   * POST /domains/check
   * Check domain availability with real Namecheap API
   *
   * TODO (SECURITY): Add authentication middleware
   * TODO (SECURITY): Add rate limiting (prevent enumeration attacks)
   */
  server.post<{
    Body: { domains: string[]; userId?: string };
  }>('/domains/check', async (request, reply) => {
    const { domains, userId } = request.body || {};

    if (!domains || domains.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'At least one domain is required',
      });
    }

    if (domains.length > 50) {
      return reply.status(400).send({
        success: false,
        error: 'Maximum 50 domains per request',
      });
    }

    try {
      // Check domains via Namecheap
      const checkResults = await namecheapClient.checkDomains(domains);

      // Enrich results with pricing from cache
      const enrichedResults = await Promise.all(
        checkResults.map(async (result) => {
          // Extract TLD (support multi-part TLDs like "co.uk")
          const { tld } = splitDomain(result.domain);

          // Get pricing from cache
          const pricing = await pricingCache.getTldPricing(tld, 'REGISTER');

          return {
            domain: result.domain,
            available: result.available,
            isPremium: result.isPremium,
            price: result.isPremium
              ? result.premiumRegistrationPrice
              : (pricing?.wholesalePrice || 0),
            retailPrice: pricing?.retailPrice || 0,
            icannFee: result.icannFee || pricing?.icannFee || 0,
            registrar: 'Namecheap',
          };
        })
      );

      request.log.info({
        domains,
        userId,
        resultsCount: enrichedResults.length,
      }, 'Domain availability check completed');

      return {
        success: true,
        data: {
          domains: enrichedResults,
        },
      };
    } catch (error) {
      request.log.error({ error, domains }, 'Domain check failed');
      return reply.status(500).send({
        success: false,
        error: 'Failed to check domain availability',
      });
    }
  });

  /**
   * POST /domains/register
   * Register a domain - creates BullMQ job for async processing
   *
   * TODO (SECURITY): Add authentication middleware (CRITICAL - financial operation)
   * TODO (SECURITY): Add authorization check (user owns projectId)
   * TODO (SECURITY): Add payment verification (Stripe checkout completed)
   * TODO (SECURITY): Add rate limiting (prevent abuse)
   */
  server.post<{
    Body: Omit<RegisterDomainJobData, 'jobId' | 'operation' | 'status' | 'createdAt' | 'updatedAt' | 'attempts'>;
  }>('/domains/register', async (request, reply) => {
    const jobData = request.body;

    if (!jobData.domainName) {
      return reply.status(400).send({
        success: false,
        error: 'Domain name is required',
      });
    }

    if (!jobData.registrant || !jobData.tech || !jobData.admin || !jobData.auxBilling) {
      return reply.status(400).send({
        success: false,
        error: 'All contact information is required',
      });
    }

    try {
      // Create BullMQ job for domain registration
      const job = await domainQueue.add(
        'register',
        {
          ...jobData,
          jobId: '', // Placeholder - will be overwritten with actual BullMQ job ID
          operation: 'register' as DomainOperationType,
          status: 'pending' as DomainJobStatus,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attempts: 0,
        },
        {
          priority: 1, // CRITICAL - user has paid
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      );

      // Update job data with actual BullMQ job ID so worker events have correct correlation
      if (job.id) {
        await job.updateData({
          ...(job.data as any),
          jobId: job.id,
        });
      }

      request.log.info({
        jobId: job.id,
        domain: jobData.domainName,
        projectId: jobData.projectId,
      }, 'Domain registration job created');

      return {
        success: true,
        data: {
          jobId: job.id,
          status: 'pending',
          message: 'Domain registration job created',
        },
      };
    } catch (error) {
      request.log.error({ error, domain: jobData.domainName }, 'Failed to create registration job');
      return reply.status(500).send({
        success: false,
        error: 'Failed to create registration job',
      });
    }
  });

  /**
   * GET /domains/jobs/:jobId
   * Get domain job status
   *
   * TODO (SECURITY - CRITICAL): Add authentication middleware
   * TODO (SECURITY - CRITICAL): Add authorization check (verify user owns this job)
   * SECURITY WARNING: This endpoint is vulnerable to IDOR. BullMQ job IDs are often
   * enumerable (e.g., sequential integers), allowing attackers to iterate through
   * job IDs and exfiltrate PII (registrant contact info). MUST add authorization
   * before production deployment.
   */
  server.get<{
    Params: { jobId: string };
  }>('/domains/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params;

    try {
      const job = await domainQueue.getJob(jobId);

      if (!job) {
        return reply.status(404).send({
          success: false,
          error: 'Job not found',
        });
      }

      // TODO (SECURITY): Verify that request.user.id matches job.data.userId
      // Example:
      // if (!request.user || request.user.id !== job.data.userId) {
      //   return reply.status(403).send({
      //     success: false,
      //     error: 'Forbidden - you do not own this job',
      //   });
      // }

      const state = await job.getState();
      const progress = job.progress;
      const returnValue = job.returnvalue;
      const failedReason = job.failedReason;

      // Return only safe subset of job data to prevent PII exposure
      // Do NOT return full job.data (contains registrant contact info)
      const safeData = {
        domainName: (job.data as any).domainName,
        projectId: (job.data as any).projectId,
        operation: (job.data as any).operation,
        status: (job.data as any).status,
        // Omit: registrant, tech, admin, auxBilling (PII)
      };

      return {
        success: true,
        data: {
          jobId: job.id,
          state,
          progress,
          data: safeData, // Only safe fields, not full job.data
          result: returnValue,
          error: failedReason,
        },
      };
    } catch (error) {
      request.log.error({ error, jobId }, 'Failed to get job status');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get job status',
      });
    }
  });

  /**
   * GET /domains/pricing/:tld
   * Get pricing for a specific TLD
   *
   * TODO (SECURITY): Add rate limiting (prevent scraping)
   */
  server.get<{
    Params: { tld: string };
    Querystring: { action?: 'REGISTER' | 'RENEW' };
  }>('/domains/pricing/:tld', async (request, reply) => {
    const { tld } = request.params;
    const { action = 'REGISTER' } = request.query;

    try {
      const pricing = await pricingCache.getTldPricing(tld, action);

      if (!pricing) {
        return reply.status(404).send({
          success: false,
          error: `Pricing not found for TLD: ${tld}`,
        });
      }

      return {
        success: true,
        data: pricing,
      };
    } catch (error) {
      request.log.error({ error, tld }, 'Failed to get pricing');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get pricing',
      });
    }
  });
}

/**
 * Stripe checkout routes
 *
 * Stack 10: Stripe checkout session creation
 *
 * Routes for creating Stripe checkout sessions for domain purchases.
 */

import type { FastifyInstance } from 'fastify';
import type { DomainCheckoutPricing } from '@forj/shared';
import { createDomainCheckoutSession, getCheckoutSession } from '../lib/stripe-client.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyProjectOwnership } from '../lib/authorization.js';

/**
 * Stripe checkout routes
 */
export async function stripeCheckoutRoutes(server: FastifyInstance) {
  /**
   * POST /stripe/create-checkout-session
   * Create a Stripe checkout session for domain purchase
   *
   * SECURITY: Authentication middleware applied
   * SECURITY: Authorization check - verifies user owns project
   *
   * CRITICAL TODO (BEFORE PRODUCTION):
   * This endpoint currently trusts client-supplied pricing (pricing.total, pricing.currency).
   * An attacker can manipulate the request body to pay any amount for a domain.
   *
   * FIX REQUIRED:
   * - Fetch pricing from PricingCache or Namecheap API based on domainName + years
   * - Calculate server-side total: domainPrice * years + FORJ_SERVICE_FEE
   * - Ignore client-provided pricing.total and pricing.currency entirely
   * - Only use pricing.domainName for validation against calculated price
   *
   * Example:
   *   const { getTldPricing } = await import('../lib/pricing-cache.js');
   *   const serverPricing = await getTldPricing(domainName, years);
   *   if (!serverPricing) return 400 "Domain pricing unavailable";
   *   // Use serverPricing.total instead of request.body.pricing.total
   */
  server.post<{
    Body: {
      projectId: string;
      pricing: DomainCheckoutPricing;
      years: number;
      isPremium: boolean;
      jobId?: string;
    };
  }>(
    '/stripe/create-checkout-session',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { projectId, pricing, years, isPremium, jobId } = request.body;
      const userId = request.user!.userId;
      const userEmail = request.user!.email;

      // Validate input
      if (!projectId || !pricing || !pricing.domainName) {
        return reply.status(400).send({
          success: false,
          error: 'Missing required fields: projectId, pricing, domainName',
        });
      }

      if (!years || years < 1 || years > 10) {
        return reply.status(400).send({
          success: false,
          error: 'Registration years must be between 1 and 10',
        });
      }

      // AUTHORIZATION CHECK: Verify user owns this project
      const ownsProject = await verifyProjectOwnership(projectId, userId, request.log);
      if (!ownsProject) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden - you do not own this project',
          code: 'FORBIDDEN',
        });
      }

      try {
        // Create Stripe checkout session
        const session = await createDomainCheckoutSession({
          pricing,
          projectId,
          userId,
          userEmail,
          years,
          isPremium,
          jobId,
        });

        request.log.info(
          {
            sessionId: session.id,
            domainName: pricing.domainName,
            userId,
            projectId,
          },
          'Checkout session created'
        );

        return {
          success: true,
          data: {
            sessionId: session.id,
            sessionUrl: session.url,
            expiresAt: session.expires_at,
          },
        };
      } catch (error) {
        request.log.error({ error, pricing }, 'Failed to create checkout session');
        return reply.status(500).send({
          success: false,
          error: 'Failed to create checkout session',
        });
      }
    }
  );

  /**
   * GET /stripe/checkout-session/:sessionId
   * Retrieve a checkout session
   *
   * SECURITY: Authentication middleware applied
   * Note: We don't verify ownership here because Stripe sessions are user-specific
   * and contain the user's email. However, an attacker could potentially enumerate
   * session IDs. In production, consider adding rate limiting or additional checks.
   */
  server.get<{
    Params: { sessionId: string };
  }>(
    '/stripe/checkout-session/:sessionId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sessionId } = request.params;

      try {
        // Retrieve session from Stripe
        const session = await getCheckoutSession(sessionId);

        // Ownership check - verify userId from metadata matches authenticated user
        // Using metadata.userId instead of customer_email for more reliable authorization
        const sessionUserId = session.metadata?.userId;
        if (!sessionUserId || sessionUserId !== request.user!.userId) {
          return reply.status(403).send({
            success: false,
            error: 'Forbidden - this session belongs to a different user',
            code: 'FORBIDDEN',
          });
        }

        return {
          success: true,
          data: {
            id: session.id,
            status: session.status,
            paymentStatus: session.payment_status,
            amountTotal: session.amount_total,
            currency: session.currency,
            metadata: session.metadata,
          },
        };
      } catch (error) {
        request.log.error({ error, sessionId }, 'Failed to retrieve checkout session');
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve checkout session',
        });
      }
    }
  );
}

/**
 * Stripe checkout routes
 *
 * Stack 10: Stripe checkout session creation
 * Stack 11: Server-side pricing validation (CRITICAL security fix)
 *
 * Routes for creating Stripe checkout sessions for domain purchases.
 */

import type { FastifyInstance } from 'fastify';
import type { DomainCheckoutPricing } from '@forj/shared';
import { splitDomain, dollarsToCents, centsToDollars } from '@forj/shared';
import { createDomainCheckoutSession, getCheckoutSession } from '../lib/stripe-client.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyProjectOwnership } from '../lib/authorization.js';
import { updateProjectStripeSession } from '../lib/database.js';
import type { PricingCache } from '../lib/pricing-cache.js';

/**
 * Get Forj service fee from environment (in cents)
 * Stack 11: Made configurable via FORJ_SERVICE_FEE_CENTS
 */
function getServiceFeeCents(): number {
  const fee = process.env.FORJ_SERVICE_FEE_CENTS;
  if (fee) {
    const parsed = parseInt(fee, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0; // Default: no service fee
}

/**
 * Stripe checkout routes
 *
 * @param server - Fastify instance
 * @param pricingCache - REQUIRED PricingCache for server-side pricing validation
 *
 * Stack 11: Server-side pricing validation is now MANDATORY
 * If PricingCache is unavailable, routes will not be registered (handled in server.ts)
 */
export async function stripeCheckoutRoutes(
  server: FastifyInstance,
  pricingCache: PricingCache
) {
  /**
   * POST /stripe/create-checkout-session
   * Create a Stripe checkout session for domain purchase
   *
   * SECURITY: Authentication middleware applied
   * SECURITY: Authorization check - verifies user owns project
   * SECURITY: Server-side pricing validation (Stack 11) - prevents price manipulation
   *
   * When PricingCache is available, pricing is fetched from Namecheap API
   * and calculated server-side. Client-provided pricing is ignored to prevent
   * attackers from manipulating payment amounts.
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

      // Validate domain name format (basic check before attempting to split)
      // Must contain at least one dot and valid characters
      const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
      if (!domainRegex.test(pricing.domainName)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid domain name format',
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

      // SERVER-SIDE PRICING VALIDATION (Stack 11 - CRITICAL security fix)
      // All pricing is calculated server-side to prevent price manipulation.
      // Client-provided pricing is completely ignored for security.
      //
      // Stack 11 fixes:
      // - Premium domain pricing now handled correctly
      // - All calculations use cents (integers) to avoid floating-point errors
      // - Service fee is configurable via FORJ_SERVICE_FEE_CENTS environment variable
      // - No fallback to client pricing - fails securely if pricing unavailable

      let validatedPricing: DomainCheckoutPricing;

      try {
        // Check if this is a premium domain and get premium pricing if applicable
        const domainCheck = await pricingCache.checkDomainPremiumPrice(pricing.domainName);

        if (!domainCheck) {
          return reply.status(400).send({
            success: false,
            error: 'Unable to verify domain pricing',
          });
        }

        let domainPricePerYearCents: number;
        let icannFeePerYearCents: number;
        let currency: string;

        if (isPremium && domainCheck.isPremium) {
          // Premium domain - use premium pricing from domain check
          if (!domainCheck.premiumPrice) {
            request.log.error(
              { domainName: pricing.domainName },
              'Premium domain flagged but no premium price available'
            );
            return reply.status(400).send({
              success: false,
              error: 'Premium domain pricing unavailable',
            });
          }

          domainPricePerYearCents = dollarsToCents(domainCheck.premiumPrice);
          icannFeePerYearCents = domainCheck.icannFee ? dollarsToCents(domainCheck.icannFee) : 0;
          currency = 'USD'; // Namecheap premium pricing is in USD

          request.log.info(
            {
              domainName: pricing.domainName,
              isPremium: true,
              premiumPriceCents: domainPricePerYearCents,
            },
            'Using premium domain pricing'
          );
        } else if (isPremium && !domainCheck.isPremium) {
          // Client claims premium but server says standard - reject as potential attack
          request.log.warn(
            { domainName: pricing.domainName },
            'Client flagged domain as premium but server check says standard domain'
          );
          return reply.status(400).send({
            success: false,
            error: 'Domain pricing mismatch - please refresh and try again',
          });
        } else if (!isPremium && domainCheck.isPremium) {
          // Server says premium but client didn't flag it - inform user
          request.log.info(
            { domainName: pricing.domainName },
            'Domain is premium but client did not indicate - using premium pricing'
          );

          if (!domainCheck.premiumPrice) {
            return reply.status(400).send({
              success: false,
              error: 'This is a premium domain - pricing unavailable',
            });
          }

          domainPricePerYearCents = dollarsToCents(domainCheck.premiumPrice);
          icannFeePerYearCents = domainCheck.icannFee ? dollarsToCents(domainCheck.icannFee) : 0;
          currency = 'USD';
        } else {
          // Standard domain - fetch TLD pricing
          let tld: string;
          try {
            const splitResult = splitDomain(pricing.domainName);
            tld = splitResult.tld;
          } catch (error) {
            // splitDomain throws for invalid domain format
            request.log.warn({ domainName: pricing.domainName, error }, 'Invalid domain format');
            return reply.status(400).send({
              success: false,
              error: 'Invalid domain name format',
            });
          }

          const tldPricing = await pricingCache.getTldPricing(tld);

          if (!tldPricing) {
            request.log.warn({ tld, domainName: pricing.domainName }, 'TLD pricing not available');
            return reply.status(400).send({
              success: false,
              error: `Pricing not available for .${tld} domains`,
            });
          }

          domainPricePerYearCents = dollarsToCents(tldPricing.wholesalePrice);
          icannFeePerYearCents = dollarsToCents(tldPricing.icannFee);
          currency = tldPricing.currency;
        }

        // Calculate server-side total (all in cents to avoid floating-point errors)
        const serviceFeeCents = getServiceFeeCents();
        const domainTotalCents = domainPricePerYearCents * years;
        const icannTotalCents = icannFeePerYearCents * years;
        const serverTotalCents = domainTotalCents + icannTotalCents + serviceFeeCents;

        // Convert back to dollars for DomainCheckoutPricing interface
        validatedPricing = {
          domainName: pricing.domainName,
          domainPrice: centsToDollars(domainPricePerYearCents),
          icannFee: centsToDollars(icannFeePerYearCents),
          serviceFee: centsToDollars(serviceFeeCents),
          total: centsToDollars(serverTotalCents),
          currency: currency,
        };

        request.log.info(
          {
            domainName: pricing.domainName,
            isPremium: isPremium,
            serverTotalCents: serverTotalCents,
            serverTotalDollars: validatedPricing.total,
            years: years,
            validated: true,
          },
          'Server-side pricing validation completed'
        );
      } catch (error) {
        request.log.error(
          { error, domainName: pricing.domainName },
          'Failed to validate pricing server-side'
        );
        return reply.status(500).send({
          success: false,
          error: 'Unable to validate domain pricing',
        });
      }

      try {
        // Create Stripe checkout session with validated pricing
        const session = await createDomainCheckoutSession({
          pricing: validatedPricing,
          projectId,
          userId,
          userEmail,
          years,
          isPremium,
          jobId,
        });

        // Store Stripe session on project for webhook correlation
        await updateProjectStripeSession(projectId, session.id);

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

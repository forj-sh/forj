/**
 * Public pricing route
 *
 * Exposes machine-readable pricing for agents and humans. No authentication
 * required — all data here is public and matches what a user is actually
 * charged during Stripe Checkout.
 *
 * Source of truth:
 *   - Service fee: `getServiceFeeCents()` (honors `FORJ_SERVICE_FEE_CENTS` env)
 *   - Domain wholesale + ICANN fee: `PricingCache` (Namecheap-backed)
 *
 * All math is done in integer cents to avoid floating-point drift with the
 * cents-based Stripe checkout path. Dollars only appear at serialization.
 *
 * Shape matches https://forj.sh/pricing.md so agents can discover pricing
 * without scraping the landing page.
 */

import type { FastifyInstance } from 'fastify';
import { centsToDollars, dollarsToCents } from '@forj/shared';
import { PricingCache, COMMON_TLDS } from '../lib/pricing-cache.js';
import { getServiceFeeCents } from '../lib/service-fee.js';

/**
 * The forj service fee is USD-denominated, so we can only compute a correct
 * `total` for TLDs that Namecheap also returns in USD. Non-USD entries are
 * skipped with a warning rather than producing a silently wrong cross-currency
 * sum.
 */
const SERVICE_FEE_CURRENCY = 'USD';

export async function pricingRoutes(
  server: FastifyInstance,
  pricingCache: PricingCache
) {
  /**
   * GET /v1/pricing
   *
   * Public, unauthenticated. Returns forj's flat service fee plus live
   * wholesale pricing for common TLDs.
   *
   * Cache layers:
   *   - HTTP: Cache-Control public, max-age=300 (5 minutes)
   *   - Server: PricingCache Redis TTL (1 hour, see pricing-cache.ts)
   *
   * Premium domains are not included — call POST /domains/check for a live
   * quote on a specific domain name.
   */
  server.get('/v1/pricing', async (_request, reply) => {
    const pricingMap = await pricingCache.getMultipleTldPricing(
      [...COMMON_TLDS],
      'REGISTER'
    );

    const serviceFeeCents = getServiceFeeCents();

    const domains: Record<
      string,
      { wholesale: number; icannFee: number; total: number; currency: string }
    > = {};

    for (const [tld, pricing] of pricingMap.entries()) {
      if (!pricing) continue;

      // Service fee is USD; cross-currency sums would be silently wrong.
      if (pricing.currency !== SERVICE_FEE_CURRENCY) {
        server.log.warn(
          { tld, currency: pricing.currency },
          'Skipping TLD from public pricing: currency does not match service fee currency'
        );
        continue;
      }

      // Compute in integer cents to match Stripe checkout math exactly.
      const wholesaleCents = dollarsToCents(pricing.wholesalePrice ?? 0);
      const icannFeeCents = dollarsToCents(pricing.icannFee ?? 0);
      const totalCents = wholesaleCents + icannFeeCents + serviceFeeCents;

      domains[tld.toLowerCase()] = {
        wholesale: centsToDollars(wholesaleCents),
        icannFee: centsToDollars(icannFeeCents),
        total: centsToDollars(totalCents),
        currency: pricing.currency,
      };
    }

    // Derive top-level currency from actual data rather than hardcoding it,
    // so the response stays internally consistent if multi-currency support
    // is added later. Currently always USD because we filter above.
    const domainEntries = Object.values(domains);
    const currency =
      domainEntries.length > 0 ? domainEntries[0].currency : SERVICE_FEE_CURRENCY;

    // Cache publicly for 5 minutes. Namecheap wholesale pricing is stable
    // at minute-to-minute granularity; the 1-hour server-side Redis TTL in
    // PricingCache is the source of truth for upstream freshness.
    reply.header('Cache-Control', 'public, max-age=300');

    return {
      success: true,
      data: {
        currency,
        serviceFee: {
          amount: centsToDollars(serviceFeeCents),
          per: 'project',
          description:
            'Flat forj fee per project. No tiers, no subscription, unlimited projects.',
        },
        included: [
          'Domain registration (wholesale + ICANN fee pass-through)',
          'GitHub organization and repository',
          'Cloudflare DNS zone',
          'Nameserver wiring (Namecheap → Cloudflare)',
        ],
        domains,
        notes: {
          premiumDomains:
            'Premium domains are priced by the registry. Call POST /domains/check for a live quote.',
          payment:
            'Payment via Stripe Checkout. Autonomous agent payment is not yet supported.',
          humanReadable: 'https://forj.sh/pricing.md',
          llmsTxt: 'https://forj.sh/llms.txt',
        },
        // Timestamp of *this response*, not of the underlying pricing data.
        // The pricing itself may be up to 1 hour old (PricingCache Redis TTL).
        generatedAt: new Date().toISOString(),
      },
    };
  });
}

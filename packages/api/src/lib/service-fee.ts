/**
 * Forj service fee source of truth.
 *
 * Both the Stripe checkout route and the public `/v1/pricing` endpoint MUST
 * read the service fee from here so that the advertised price and the amount
 * actually charged can never drift apart.
 *
 * Stack 11 introduced the `FORJ_SERVICE_FEE_CENTS` env override. We honor it
 * here and expose a single helper that returns the fee in integer cents —
 * all downstream math should stay in cents until the moment of display to
 * avoid floating-point rounding bugs.
 */

import { DEFAULT_SERVICE_FEE_DOLLARS, dollarsToCents } from '@forj/shared';

/**
 * Get the forj service fee in integer cents.
 *
 * Resolution order:
 *   1. `FORJ_SERVICE_FEE_CENTS` env var, if set to a non-negative integer
 *   2. `DEFAULT_SERVICE_FEE_DOLLARS` from `@forj/shared`
 */
export function getServiceFeeCents(): number {
  const fee = process.env.FORJ_SERVICE_FEE_CENTS;
  if (fee) {
    const parsed = parseInt(fee, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return dollarsToCents(DEFAULT_SERVICE_FEE_DOLLARS);
}

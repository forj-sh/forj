/**
 * Stripe integration types
 *
 * Reference: Stripe API documentation (https://stripe.com/docs/api)
 *
 * Types for Stripe checkout, webhooks, and payment processing.
 */

/**
 * Stripe checkout session metadata (raw format from Stripe)
 *
 * Attached to Stripe checkout sessions for tracking domain purchases.
 *
 * IMPORTANT: All Stripe metadata values are strings. Parse before use:
 * - years: Number(metadata.years)
 * - isPremium: metadata.isPremium === 'true'
 */
export interface StripeCheckoutMetadata {
  /** Project ID */
  projectId: string;
  /** User ID */
  userId: string;
  /** Domain name being purchased */
  domainName: string;
  /** Registration years (as string - parse with Number()) */
  years: string;
  /** Domain job ID (if already created) */
  jobId?: string;
  /** Is premium domain (as string - parse with === 'true') */
  isPremium: string;
}

/**
 * Parsed checkout metadata with correct types
 *
 * Use this after parsing raw Stripe metadata strings.
 */
export interface ParsedCheckoutMetadata {
  projectId: string;
  userId: string;
  domainName: string;
  years: number;
  jobId?: string;
  isPremium: boolean;
}

/**
 * Parse Stripe checkout metadata from strings to correct types
 *
 * @param metadata - Raw Stripe metadata (all values are strings)
 * @returns Parsed metadata with correct types
 * @throws Error if required fields are missing or invalid
 */
export function parseCheckoutMetadata(metadata: StripeCheckoutMetadata): ParsedCheckoutMetadata {
  if (!metadata.projectId || !metadata.userId || !metadata.domainName || !metadata.years) {
    throw new Error('Missing required checkout metadata fields');
  }

  const years = Number(metadata.years);
  if (isNaN(years) || years < 1 || years > 10) {
    throw new Error(`Invalid years value: ${metadata.years}`);
  }

  return {
    projectId: metadata.projectId,
    userId: metadata.userId,
    domainName: metadata.domainName,
    years,
    jobId: metadata.jobId,
    isPremium: metadata.isPremium === 'true',
  };
}

/**
 * Stripe webhook event types we handle
 */
export enum StripeWebhookEvent {
  /** Checkout session completed - payment succeeded */
  CHECKOUT_COMPLETED = 'checkout.session.completed',
  /** Payment intent succeeded */
  PAYMENT_SUCCEEDED = 'payment_intent.succeeded',
  /** Payment intent failed */
  PAYMENT_FAILED = 'payment_intent.payment_failed',
  /** Charge refunded */
  CHARGE_REFUNDED = 'charge.refunded',
}

/**
 * Domain purchase payment data
 */
export interface DomainPaymentData {
  /** Stripe checkout session ID */
  sessionId: string;
  /** Stripe payment intent ID */
  paymentIntentId: string;
  /** Amount charged (in cents) */
  amountCharged: number;
  /** Currency */
  currency: string;
  /** Project ID */
  projectId: string;
  /** User ID */
  userId: string;
  /** Domain name */
  domainName: string;
  /** Registration years */
  years: number;
  /** Payment status */
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  /** Timestamp */
  timestamp: number;
  /** Job ID (if registration job created) */
  jobId?: string;
}

/**
 * Stripe webhook payload
 *
 * Use type guards to narrow data.object before accessing properties.
 */
export interface StripeWebhookPayload {
  /** Webhook event type */
  type: StripeWebhookEvent;
  /** Event data */
  data: {
    /** Stripe object (use type guards to narrow before access) */
    object: unknown;
  };
  /** Event ID */
  id: string;
  /** Created timestamp */
  created: number;
}

/**
 * Stripe configuration
 */
export interface StripeConfig {
  /** Stripe secret key */
  secretKey: string;
  /** Stripe webhook signing secret */
  webhookSecret: string;
  /** Success URL after checkout */
  successUrl: string;
  /** Cancel URL if checkout cancelled */
  cancelUrl: string;
  /** Stripe API version */
  apiVersion?: string;
}

/**
 * Domain pricing for Stripe checkout
 */
export interface DomainCheckoutPricing {
  /** Domain name */
  domainName: string;
  /** Base domain price (wholesale) */
  domainPrice: number;
  /** ICANN fee */
  icannFee: number;
  /** Forj service fee */
  serviceFee: number;
  /** Total price */
  total: number;
  /** Currency */
  currency: string;
}

/** Default Forj service fee in dollars, bundled with every domain purchase */
export const DEFAULT_SERVICE_FEE_DOLLARS = 1.0;

/**
 * Calculate total price for domain purchase
 *
 * @param domainPrice - Wholesale domain price
 * @param icannFee - ICANN fee
 * @param serviceFee - Forj service fee (default $1)
 * @returns Total price calculation
 */
export function calculateDomainPricing(
  domainPrice: number,
  icannFee: number,
  serviceFee = DEFAULT_SERVICE_FEE_DOLLARS
): { subtotal: number; total: number } {
  const subtotal = domainPrice + icannFee;
  const total = subtotal + serviceFee;
  return { subtotal, total };
}

/**
 * Convert dollars to cents for Stripe
 *
 * @param dollars - Amount in dollars
 * @returns Amount in cents
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars
 *
 * @param cents - Amount in cents
 * @returns Amount in dollars
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

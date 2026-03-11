/**
 * Stripe client wrapper
 *
 * Stack 8: Install Stripe SDK + client wrapper
 *
 * Initializes Stripe SDK with configuration and provides helper methods
 * for common operations like creating checkout sessions.
 */

import Stripe from 'stripe';
import { logger } from './logger.js';
import type { DomainCheckoutPricing } from '@forj/shared';
import { dollarsToCents } from '@forj/shared';

/**
 * Stripe configuration from environment variables
 */
export interface StripeClientConfig {
  secretKey: string;
  webhookSecret: string;
  successUrl?: string;
  cancelUrl?: string;
}

/**
 * Get Stripe configuration from environment
 *
 * @returns Stripe configuration or null if not configured
 */
export function getStripeConfig(): StripeClientConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return null;
  }

  return {
    secretKey,
    webhookSecret,
    successUrl: process.env.STRIPE_SUCCESS_URL || 'https://forj.sh/success',
    cancelUrl: process.env.STRIPE_CANCEL_URL || 'https://forj.sh/cancel',
  };
}

/**
 * Initialize Stripe client
 *
 * @param config - Stripe configuration
 * @returns Initialized Stripe client
 */
export function createStripeClient(config: StripeClientConfig): Stripe {
  return new Stripe(config.secretKey, {
    apiVersion: '2026-02-25.clover', // Current Stripe API version
    typescript: true,
  });
}

/**
 * Stripe client singleton
 */
let stripeClient: Stripe | null = null;
let stripeConfig: StripeClientConfig | null = null;

/**
 * Get or create Stripe client singleton
 *
 * @returns Stripe client or null if not configured
 */
export function getStripeClient(): Stripe | null {
  if (stripeClient) {
    return stripeClient;
  }

  const config = getStripeConfig();
  if (!config) {
    logger.warn('Stripe not configured - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET required');
    return null;
  }

  stripeClient = createStripeClient(config);
  stripeConfig = config;
  logger.info('Stripe client initialized');

  return stripeClient;
}

/**
 * Get Stripe webhook secret
 *
 * @returns Webhook secret or null if not configured
 */
export function getStripeWebhookSecret(): string | null {
  // Ensure the client and config are initialized via the singleton getter
  getStripeClient();
  return stripeConfig?.webhookSecret || null;
}

/**
 * Create checkout session parameters
 */
export interface CreateCheckoutSessionParams {
  /** Pricing information */
  pricing: DomainCheckoutPricing;
  /** Project ID */
  projectId: string;
  /** User ID */
  userId: string;
  /** User email */
  userEmail: string;
  /** Registration years */
  years: number;
  /** Is premium domain */
  isPremium: boolean;
  /** Job ID (optional - can be added after job creation) */
  jobId?: string;
}

/**
 * Create a Stripe checkout session for domain purchase
 *
 * @param params - Checkout session parameters
 * @returns Stripe checkout session
 * @throws Error if Stripe is not configured or session creation fails
 */
export async function createDomainCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const config = stripeConfig!;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: params.userEmail,
      line_items: [
        {
          price_data: {
            currency: params.pricing.currency.toLowerCase(),
            product_data: {
              name: `Domain Registration: ${params.pricing.domainName}`,
              description: `${params.years} year${params.years > 1 ? 's' : ''} registration`,
              metadata: {
                domainName: params.pricing.domainName,
                years: params.years.toString(),
              },
            },
            unit_amount: dollarsToCents(params.pricing.total),
          },
          quantity: 1,
        },
      ],
      metadata: {
        projectId: params.projectId,
        userId: params.userId,
        domainName: params.pricing.domainName,
        years: params.years.toString(),
        isPremium: params.isPremium.toString(),
        ...(params.jobId ? { jobId: params.jobId } : {}),
      },
      success_url: `${config.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: config.cancelUrl,
      // Allow promotion codes
      allow_promotion_codes: true,
      // Expires after 30 minutes
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    logger.info({
      sessionId: session.id,
      domainName: params.pricing.domainName,
      amount: params.pricing.total,
      userId: params.userId,
    }, 'Stripe checkout session created');

    return session;
  } catch (error) {
    logger.error({ error, params: { ...params, userEmail: '[REDACTED]' } }, 'Failed to create Stripe checkout session');
    throw error;
  }
}

/**
 * Retrieve a checkout session
 *
 * @param sessionId - Stripe checkout session ID
 * @returns Checkout session
 * @throws Error if Stripe is not configured or retrieval fails
 */
export async function getCheckoutSession(
  sessionId: string
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    return session;
  } catch (error) {
    logger.error({ error, sessionId }, 'Failed to retrieve checkout session');
    throw error;
  }
}

/**
 * Create a refund for a payment
 *
 * @param paymentIntentId - Stripe payment intent ID
 * @param amount - Amount to refund in cents (optional - defaults to full refund)
 * @param reason - Refund reason ('duplicate', 'fraudulent', or 'requested_by_customer')
 * @returns Stripe refund
 * @throws Error if Stripe is not configured or refund fails
 */
export async function createRefund(
  paymentIntentId: string,
  amount?: number,
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amount ? { amount } : {}),
      ...(reason ? { reason } : {}),
    });

    logger.info({
      refundId: refund.id,
      paymentIntentId,
      amount: refund.amount,
      status: refund.status,
    }, 'Stripe refund created');

    return refund;
  } catch (error) {
    logger.error({ error, paymentIntentId }, 'Failed to create refund');
    throw error;
  }
}

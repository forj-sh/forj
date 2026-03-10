/**
 * Stripe webhook handlers
 *
 * Reference: Stripe API documentation (https://stripe.com/docs/webhooks)
 *
 * Handles Stripe webhooks for domain payment processing.
 *
 * INTEGRATION STATUS:
 * These routes are defined but NOT YET REGISTERED with the Fastify server.
 * They require:
 * - Stripe SDK initialization (npm install stripe)
 * - Domain job queue setup
 * - Route registration in server.ts
 * - Raw body parser configuration for signature verification
 *
 * SECURITY NOTE:
 * Webhook signature verification is CRITICAL. Without it, anyone can forge
 * webhook requests and trigger domain registrations without payment.
 * The Stripe SDK's constructEvent() method MUST be used to verify signatures.
 */

import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type {
  StripeWebhookPayload,
  StripeCheckoutMetadata,
  DomainPaymentData,
  RegisterDomainJobData,
} from '@forj/shared';
import { DomainOperationType, DomainJobStatus, parseCheckoutMetadata } from '@forj/shared';

/**
 * Stripe webhook routes
 */
export async function stripeWebhookRoutes(
  server: FastifyInstance,
  domainQueue: Queue,
  stripeWebhookSecret: string
) {
  /**
   * POST /webhooks/stripe
   * Handle Stripe webhook events
   *
   * SECURITY (CRITICAL):
   * - Webhook signature verification is REQUIRED (currently TODO)
   * - Raw request body is needed for signature verification
   * - Without verification, anyone can forge webhooks and trigger registrations
   *
   * TODO (CRITICAL - BEFORE PRODUCTION):
   * 1. Install Stripe SDK: npm install stripe
   * 2. Import Stripe: import Stripe from 'stripe';
   * 3. Initialize client: const stripe = new Stripe(secretKey);
   * 4. Verify signature in request handler (see example below)
   * 5. Configure Fastify raw body parser
   */
  server.post('/webhooks/stripe', async (request, reply) => {
    // Normalize signature header (can be string or string array)
    const signatureHeader = request.headers['stripe-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!signature) {
      return reply.status(400).send({
        success: false,
        error: 'Missing Stripe signature',
      });
    }

    // CRITICAL TODO: Verify webhook signature before processing
    // Example implementation (requires Stripe SDK):
    //
    // try {
    //   const rawBody = request.rawBody; // Fastify rawBody plugin
    //   const event = stripe.webhooks.constructEvent(
    //     rawBody,
    //     signature,
    //     stripeWebhookSecret
    //   );
    //   payload = event as StripeWebhookPayload;
    // } catch (err) {
    //   server.log.error({ err, signature }, 'Webhook signature verification failed');
    //   return reply.status(401).send({
    //     success: false,
    //     error: 'Invalid signature',
    //   });
    // }

    // TEMPORARY: Parse body directly (INSECURE - replace with signature verification)
    const payload = request.body as StripeWebhookPayload;

    try {
      switch (payload.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(payload, domainQueue, server);
          break;

        case 'payment_intent.succeeded':
          await handlePaymentSucceeded(payload, server);
          break;

        case 'payment_intent.payment_failed':
          await handlePaymentFailed(payload, server);
          break;

        case 'charge.refunded':
          await handleChargeRefunded(payload, domainQueue, server);
          break;

        default:
          server.log.info({ type: payload.type }, 'Unhandled webhook event');
      }

      return { received: true };
    } catch (error) {
      server.log.error({ error, eventType: payload.type }, 'Webhook processing failed');
      return reply.status(500).send({
        success: false,
        error: 'Webhook processing failed',
      });
    }
  });
}

/**
 * Handle checkout.session.completed event
 *
 * User completed payment - trigger domain registration job.
 *
 * IMPORTANT:
 * - Uses session.id as BullMQ jobId for idempotency (prevents duplicate jobs on webhook retries)
 * - Metadata parsing handles Stripe's string-only values
 * - Missing required registration fields (registrant, tech, admin, auxBilling)
 *   must be fetched from database or collected during checkout
 */
async function handleCheckoutCompleted(
  payload: StripeWebhookPayload,
  domainQueue: Queue,
  server: FastifyInstance
) {
  // Type guard for session object
  const session = payload.data.object as any;

  if (!session || !session.metadata) {
    server.log.warn({ session }, 'Checkout session missing metadata');
    return;
  }

  const rawMetadata = session.metadata as StripeCheckoutMetadata;

  // Parse metadata with type conversion (Stripe metadata values are all strings)
  let parsed;
  try {
    parsed = parseCheckoutMetadata(rawMetadata);
  } catch (error) {
    server.log.error({ error, metadata: rawMetadata }, 'Invalid checkout metadata');
    return;
  }

  // TODO (CRITICAL): Fetch contact information from database
  // The RegisterDomainJobData requires:
  // - registrant: ContactInfo (name, address, phone, email)
  // - tech: ContactInfo
  // - admin: ContactInfo
  // - auxBilling: ContactInfo
  // - addFreeWhoisguard: boolean
  // - wgEnabled: boolean
  // - isPremiumDomain: boolean
  // - premiumPrice?: number
  //
  // Options:
  // 1. Store contact info during checkout flow (preferred)
  // 2. Use project/user default contact info from database
  // 3. Collect contact info after payment (requires async flow)
  //
  // Without this data, the domain worker will fail when attempting registration.

  // Create minimal job data (INCOMPLETE - will fail at worker)
  const jobData: Partial<RegisterDomainJobData> = {
    projectId: parsed.projectId,
    userId: parsed.userId,
    domainName: parsed.domainName,
    years: parsed.years,
    isPremiumDomain: parsed.isPremium,
    operation: DomainOperationType.REGISTER,
    status: DomainJobStatus.PENDING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attempts: 0,
    jobId: '', // Will be set by BullMQ
    // MISSING: registrant, tech, admin, auxBilling, addFreeWhoisguard, wgEnabled, premiumPrice
  };

  // Use session.id as BullMQ jobId for idempotency
  // Prevents duplicate registration jobs if Stripe retries webhook delivery
  const job = await domainQueue.add('register', jobData, {
    jobId: session.id, // Idempotency key
    priority: 1, // CRITICAL - user has paid
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });

  // Update job data with actual BullMQ job ID
  if (job.id) {
    await job.updateData({
      ...jobData,
      jobId: job.id,
    });
  }

  server.log.info(
    {
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
      domainName: parsed.domainName,
      jobId: job.id,
    },
    'Domain registration job created from Stripe checkout'
  );

  // TODO: Store payment data in database
  const paymentData: DomainPaymentData = {
    sessionId: session.id,
    paymentIntentId: session.payment_intent,
    amountCharged: session.amount_total,
    currency: session.currency,
    projectId: parsed.projectId,
    userId: parsed.userId,
    domainName: parsed.domainName,
    years: parsed.years,
    status: 'succeeded',
    timestamp: Date.now(),
    jobId: job.id,
  };

  // TODO: Save to database
  server.log.info({ paymentData }, 'Payment recorded');
}

/**
 * Handle payment_intent.succeeded event
 */
async function handlePaymentSucceeded(payload: StripeWebhookPayload, server: FastifyInstance) {
  const paymentIntent = payload.data.object as any;

  server.log.info(
    {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
    },
    'Payment succeeded'
  );

  // TODO: Update payment status in database
}

/**
 * Handle payment_intent.payment_failed event
 */
async function handlePaymentFailed(payload: StripeWebhookPayload, server: FastifyInstance) {
  const paymentIntent = payload.data.object as any;

  server.log.warn(
    {
      paymentIntentId: paymentIntent.id,
      failureMessage: paymentIntent.last_payment_error?.message,
    },
    'Payment failed'
  );

  // TODO: Update payment status and notify user
}

/**
 * Handle charge.refunded event
 */
async function handleChargeRefunded(
  payload: StripeWebhookPayload,
  domainQueue: Queue,
  server: FastifyInstance
) {
  const charge = payload.data.object as any;

  server.log.info(
    {
      chargeId: charge.id,
      amount: charge.amount_refunded,
    },
    'Charge refunded'
  );

  // TODO: Cancel domain registration job if still pending
  // TODO: Initiate domain transfer or release process
  // TODO: Update payment status in database
}

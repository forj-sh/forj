/**
 * Stripe webhook handlers
 *
 * Reference: Stripe API documentation (https://stripe.com/docs/webhooks)
 *
 * Handles Stripe webhooks for domain payment processing.
 *
 * INTEGRATION STATUS:
 * ✅ Webhook signature verification logic implemented in this route (Stack 9)
 * 🔧 Stripe SDK instance is REQUIRED and must be injected by the caller (server.ts)
 * 🔧 Raw body parser (@fastify/raw-body) is REQUIRED at server level for signature verification
 * TODO: Register these routes and configure @fastify/raw-body plugin in server.ts (Stack 10)
 * TODO: Domain job queue integration (Stack 10)
 *
 * SECURITY (Stack 9):
 * Webhook signature verification is now IMPLEMENTED using Stripe SDK's
 * constructEvent() method. This prevents forged webhook requests.
 * All webhooks are verified before processing.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queue } from 'bullmq';
import Stripe from 'stripe';
import type {
  StripeWebhookPayload,
  StripeCheckoutMetadata,
  DomainPaymentData,
  RegisterDomainJobData,
} from '@forj/shared';
import { DomainOperationType, DomainJobStatus, parseCheckoutMetadata, STRIPE_PAYMENT_STATUS } from '@forj/shared';
import {
  getProjectContactInfo,
  getProjectByStripeSession,
  updateProjectPaymentStatus,
  updateProjectService,
} from '../lib/database.js';

/**
 * Stripe webhook routes
 *
 * Stack 9: Signature verification implemented
 */
export async function stripeWebhookRoutes(
  server: FastifyInstance,
  stripe: Stripe,
  domainQueue: Queue,
  stripeWebhookSecret: string
) {
  /**
   * POST /webhooks/stripe
   * Handle Stripe webhook events
   *
   * SECURITY (Stack 9): Webhook signature verification IMPLEMENTED
   * - Verifies HMAC signature using Stripe SDK
   * - Uses raw request body for signature verification
   * - Prevents forged webhook requests
   *
   * NOTE: Requires @fastify/raw-body plugin to be registered at server level
   * with { runFirst: true, encoding: false } to capture the raw body bytes
   * needed for signature verification.
   */
  server.post<{ Body: string }>(
    '/webhooks/stripe',
    {
      config: {
        // Tell Fastify to preserve raw body as Buffer for signature verification
        rawBody: true,
      },
    },
    async (request, reply) => {
      // Get signature from headers
      const signatureHeader = request.headers['stripe-signature'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      if (!signature) {
        return reply.status(400).send({
          success: false,
          error: 'Missing Stripe signature header',
        });
      }

      // Get raw body for signature verification
      // Fastify provides this via @fastify/raw-body plugin when configured
      const rawBody = (request as { rawBody?: Buffer }).rawBody;

      if (!rawBody) {
        server.log.error('Raw body not available for webhook signature verification');
        return reply.status(400).send({
          success: false,
          error: 'Unable to verify webhook signature - raw body missing',
        });
      }

      // Verify webhook signature using Stripe SDK
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          rawBody,
          signature,
          stripeWebhookSecret
        ) as Stripe.Event;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        server.log.error({ error, signature }, 'Webhook signature verification failed');
        return reply.status(400).send({
          success: false,
          error: 'Invalid webhook signature',
        });
      }

      // Signature verified - safe to process
      const payload = event as unknown as StripeWebhookPayload;

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
  }
  );
}

/**
 * Handle checkout.session.completed event
 *
 * User completed payment — fetch stored contact info and trigger domain registration.
 *
 * Flow: CLI stores contact info → CLI creates checkout → user pays → this webhook fires
 *       → fetch contact info from DB → queue domain registration job
 *
 * Idempotency: Uses session.id as BullMQ jobId to prevent duplicate jobs on retries.
 */
async function handleCheckoutCompleted(
  payload: StripeWebhookPayload,
  domainQueue: Queue,
  server: FastifyInstance
) {
  const session = payload.data.object as any;

  if (!session || !session.metadata) {
    server.log.warn({ session }, 'Checkout session missing metadata');
    return;
  }

  const rawMetadata = session.metadata as StripeCheckoutMetadata;

  let parsed;
  try {
    parsed = parseCheckoutMetadata(rawMetadata);
  } catch (error) {
    server.log.error({ error, metadata: rawMetadata }, 'Invalid checkout metadata');
    return;
  }

  // Verify this session matches the one stored on the project
  // Prevents stale/duplicate sessions from triggering multiple registrations
  const project = await getProjectByStripeSession(session.id);
  if (!project) {
    // This could indicate a stale session, a race condition, or a forged/manipulated webhook.
    // Log at error level with full context for investigation.
    server.log.error(
      { sessionId: session.id, projectId: parsed.projectId, paymentIntent: session.payment_intent },
      'Stripe session does not match any stored project — ignoring webhook. Investigate if recurring.'
    );
    return;
  }

  // Verify metadata projectId matches the project linked to this session
  if (project.id !== parsed.projectId) {
    server.log.error(
      { sessionId: session.id, metadataProjectId: parsed.projectId, dbProjectId: project.id },
      'Stripe session project mismatch between metadata and database — ignoring webhook'
    );
    return;
  }

  const projectId = project.id;

  // Update payment status in database
  await updateProjectPaymentStatus(projectId, STRIPE_PAYMENT_STATUS.PAID);

  // Fetch contact info stored during the init flow (Phase 1)
  const contactData = await getProjectContactInfo(projectId);
  if (!contactData) {
    server.log.error(
      { projectId },
      'Contact info not found for project — cannot register domain'
    );
    // Mark domain service as failed so the user sees the error via SSE
    await updateProjectService(projectId, 'domain', {
      status: 'failed',
      error: 'Contact information missing. Please re-run init to provide contact details.',
      updatedAt: new Date().toISOString(),
    });
    // TODO: Initiate Stripe refund for this session since domain cannot be registered
    // without contact info. This should not happen in normal flow (CLI stores contact
    // info before checkout), but handle defensively.
    return;
  }

  const { contact, useWhoisPrivacy } = contactData;

  // Map Forj contact format to Namecheap ContactInfo (email → emailAddress)
  const namecheapContact = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    emailAddress: contact.email,
    phone: contact.phone,
    address1: contact.address1,
    address2: contact.address2,
    city: contact.city,
    stateProvince: contact.stateProvince,
    postalCode: contact.postalCode,
    country: contact.country,
    organizationName: contact.organizationName,
  };

  const jobData: RegisterDomainJobData = {
    projectId,
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
    // Use same contact for all roles (standard for small teams / individuals)
    registrant: namecheapContact,
    tech: namecheapContact,
    admin: namecheapContact,
    auxBilling: namecheapContact,
    addFreeWhoisguard: useWhoisPrivacy,
    wgEnabled: useWhoisPrivacy,
  };

  // Use session.id as BullMQ jobId for idempotency
  const job = await domainQueue.add('register', jobData, {
    jobId: session.id,
    priority: 1, // CRITICAL — user has paid
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });

  if (job.id) {
    await job.updateData({ ...jobData, jobId: job.id });
  }

  // Mark domain service as running
  await updateProjectService(projectId, 'domain', {
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  server.log.info(
    {
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
      domainName: parsed.domainName,
      jobId: job.id,
    },
    'Domain registration job created from Stripe checkout'
  );
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

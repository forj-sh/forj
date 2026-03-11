import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { NamecheapClient } from '@forj/shared';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/error-handler.js';
import { redis } from './lib/redis.js';
import { queues } from './lib/queues.js';
import { PricingCache } from './lib/pricing-cache.js';
import { healthRoutes } from './routes/health.js';
import { queueRoutes } from './routes/queues.js';
import { authRoutes } from './routes/auth.js';
import { domainRoutes } from './routes/domains.js';
import { domainNamecheapRoutes } from './routes/domains-namecheap.js';
import { projectRoutes } from './routes/projects.js';
import { eventRoutes } from './routes/events.js';
import { stripeWebhookRoutes } from './routes/stripe-webhooks.js';
import { stripeCheckoutRoutes } from './routes/stripe-checkout.js';
import { getStripeClient, getStripeWebhookSecret } from './lib/stripe-client.js';

/**
 * Create and configure Fastify server
 */
export async function createServer() {
  const server = Fastify({
    logger: logger as any,
    disableRequestLogging: false,
    requestIdLogLabel: 'reqId',
  });

  // Security plugins
  await server.register(helmet, {
    contentSecurityPolicy: false, // Disable CSP for API
  });

  await server.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://forj.sh', 'https://www.forj.sh']
      : true, // Allow all origins in development
    credentials: true,
  });

  // Error handler
  server.setErrorHandler(errorHandler);

  // Initialize Namecheap integration (if credentials available)
  // SECURITY WARNING: Namecheap routes handle financial operations (domain registration)
  // and expose PII in job payloads. Authentication, authorization, and rate limiting
  // are CRITICAL before production deployment.
  // Use ENABLE_NAMECHEAP_ROUTES=true to explicitly enable these routes.
  const hasNamecheapCredentials = !!(
    process.env.NAMECHEAP_API_USER &&
    process.env.NAMECHEAP_API_KEY &&
    process.env.NAMECHEAP_USERNAME &&
    process.env.NAMECHEAP_CLIENT_IP
  );
  const enableNamecheapRoutes = process.env.ENABLE_NAMECHEAP_ROUTES === 'true';

  let namecheapRoutesRegistered = false;
  let pricingCache: PricingCache | undefined = undefined;

  if (hasNamecheapCredentials && enableNamecheapRoutes) {
    try {
      // Initialize Namecheap client
      // Non-null assertions safe here because we checked hasNamecheapCredentials above
      const namecheapClient = new NamecheapClient({
        apiUser: process.env.NAMECHEAP_API_USER!,
        apiKey: process.env.NAMECHEAP_API_KEY!,
        userName: process.env.NAMECHEAP_USERNAME!,
        clientIp: process.env.NAMECHEAP_CLIENT_IP!,
        sandbox: process.env.NAMECHEAP_SANDBOX === 'true',
      });

      // Initialize pricing cache (only if Redis is available)
      if (redis) {
        pricingCache = new PricingCache({
          redis,
          namecheapClient,
          logger,
          ttl: 3600, // 1 hour
        });

        // Warm up cache with common TLDs (non-blocking)
        pricingCache.warmup().catch((error) => {
          logger.error({ error }, 'Failed to warm up pricing cache');
        });

        // Get domain queue
        const domainQueue = queues.domain;

        if (domainQueue) {
          // Register production Namecheap routes
          await server.register(async (instance) => {
            // Non-null assertion safe here: pricingCache was just assigned above in the if (redis) block
            await domainNamecheapRoutes(instance, namecheapClient, domainQueue, pricingCache!);
          });

          logger.info('Namecheap domain routes registered (production mode)');
          namecheapRoutesRegistered = true;
        } else {
          logger.warn('Domain queue not available - falling back to mock domain routes');
          await server.register(domainRoutes);
        }
      } else {
        logger.warn('Redis not available - falling back to mock domain routes');
        await server.register(domainRoutes);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Namecheap integration - falling back to mock domain routes');
      await server.register(domainRoutes);
    }
  } else {
    if (hasNamecheapCredentials && !enableNamecheapRoutes) {
      logger.warn(
        'Namecheap credentials configured but ENABLE_NAMECHEAP_ROUTES is not set to "true" - using mock domain routes'
      );
    } else {
      logger.info('Namecheap credentials not configured - using mock domain routes only');
    }
    // Register mock routes for development
    await server.register(domainRoutes);
  }

  // Initialize Stripe integration (if credentials available)
  const stripeClient = getStripeClient();
  const stripeWebhookSecret = getStripeWebhookSecret();

  if (stripeClient) {
    // Register Stripe checkout routes ONLY if PricingCache is available
    // Stack 11: Server-side pricing validation is now MANDATORY for security
    // Without PricingCache, we cannot validate pricing and prevent price manipulation attacks
    if (pricingCache) {
      await server.register(async (instance) => {
        await stripeCheckoutRoutes(instance, pricingCache);
      });
      logger.info('Stripe checkout routes registered with server-side pricing validation');
    } else {
      logger.warn(
        'Stripe checkout routes NOT registered - PricingCache unavailable (CRITICAL: Cannot validate pricing securely)'
      );
    }

    // Register Stripe webhook routes only if webhook secret and domain queue are available
    if (stripeWebhookSecret) {
      const domainQueue = queues.domain;

      if (domainQueue) {
        // Register Stripe webhook routes
        await server.register(async (instance) => {
          await stripeWebhookRoutes(instance, stripeClient, domainQueue, stripeWebhookSecret);
        });

        logger.info('Stripe webhook routes registered');
      } else {
        logger.warn('Domain queue not available - Stripe webhooks not registered');
      }
    } else {
      logger.warn('Stripe webhook secret not configured - Stripe webhooks not registered');
    }
  } else {
    logger.info('Stripe not configured - Stripe routes not registered');
  }

  // Routes
  await server.register(healthRoutes);
  await server.register(queueRoutes);
  await server.register(authRoutes);
  await server.register(projectRoutes);
  await server.register(eventRoutes);

  return server;
}

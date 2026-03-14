/**
 * Sentry Debug Route (Development Only)
 * 
 * Test endpoint to verify Sentry error reporting is working
 * SECURITY: Only enabled when NODE_ENV !== 'production'
 */

import type { FastifyInstance } from 'fastify';
import { Sentry } from '../instrument.js';

export async function debugSentryRoutes(server: FastifyInstance) {
  // Only register in development
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  server.get('/debug-sentry', async (request, reply) => {
    // Log before throwing error
    Sentry.logger.info('User triggered test error', {
      action: 'test_error_endpoint',
      route: '/debug-sentry',
    });

    // Throw intentional error to test Sentry
    throw new Error('Sentry test error - this is intentional!');
  });

  server.get('/debug-sentry/handled', async (request, reply) => {
    try {
      // Simulate a handled error
      throw new Error('Handled error test');
    } catch (error) {
      // Manually capture the error
      Sentry.captureException(error);
      
      return reply.status(500).send({
        success: false,
        error: 'Handled error sent to Sentry',
      });
    }
  });

  server.get('/debug-sentry/message', async (request, reply) => {
    // Test message logging
    Sentry.captureMessage('Test message from Forj API', 'info');
    
    return reply.send({
      success: true,
      message: 'Test message sent to Sentry',
    });
  });

  console.log('[Sentry] Debug endpoints registered:');
  console.log('  GET /debug-sentry - Unhandled error test');
  console.log('  GET /debug-sentry/handled - Handled error test');
  console.log('  GET /debug-sentry/message - Message logging test');
}

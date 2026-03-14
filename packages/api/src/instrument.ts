/**
 * Sentry Instrumentation for Forj API
 * 
 * IMPORTANT: This file must be imported FIRST in index.ts
 * Initializes Sentry with privacy controls and data scrubbing
 */

import * as Sentry from '@sentry/node';

const SENTRY_DSN = process.env.SENTRY_DSN_API;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
const SENTRY_TRACES_SAMPLE_RATE = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1');

// Only initialize if DSN is provided
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    
    // Release tracking (git commit SHA)
    release: process.env.GIT_COMMIT_SHA || 'forj-api@unknown',
    
    // Performance Monitoring
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    
    // Enable structured logging
    enableLogs: true,
    
    // Privacy: Do NOT send default PII
    sendDefaultPii: false,
    
    // Data scrubbing - CRITICAL for security
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }
      
      // Scrub API keys from error messages and breadcrumbs
      if (event.message) {
        event.message = scrubSensitiveData(event.message);
      }
      
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(breadcrumb => ({
          ...breadcrumb,
          message: breadcrumb.message ? scrubSensitiveData(breadcrumb.message) : breadcrumb.message,
        }));
      }
      
      // Scrub exception messages
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map(exception => ({
          ...exception,
          value: exception.value ? scrubSensitiveData(exception.value) : exception.value,
        }));
      }
      
      return event;
    },
    
    // Additional integrations
    integrations: [
      // Fastify integration will be added via setupFastifyErrorHandler
    ],
  });
  
  console.log('[Sentry] Initialized for ' + SENTRY_ENVIRONMENT + ' environment');
} else {
  console.log('[Sentry] Disabled - no DSN provided');
}

/**
 * Scrub sensitive data from strings
 * Removes API keys, tokens, passwords, etc.
 */
function scrubSensitiveData(text: string): string {
  return text
    // Forj API keys
    .replace(/forj_(live|test)_[a-zA-Z0-9]{32}/g, 'forj_1_[REDACTED]')
    // JWT tokens
    .replace(/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, '[JWT_REDACTED]')
    // Bearer tokens
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/g, 'Bearer [REDACTED]')
    // Cloudflare API tokens (40 chars, alphanumeric + dashes)
    .replace(/[a-zA-Z0-9_-]{40}/g, '[CF_TOKEN_REDACTED]')
    // GitHub tokens (ghp_, gho_, etc.)
    .replace(/gh[a-z]_[a-zA-Z0-9]{36,}/g, '[GITHUB_TOKEN_REDACTED]')
    // Stripe keys
    .replace(/sk_(live|test)_[a-zA-Z0-9]{24,}/g, 'sk_1_[REDACTED]')
    // Namecheap API keys (32 char hex)
    .replace(/[a-f0-9]{32}/g, '[NC_API_KEY_REDACTED]')
    // Generic passwords in query params or JSON
    .replace(/(password|apiKey|api_key|secret|token)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, '1=[REDACTED]');
}

export { Sentry };

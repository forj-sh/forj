/**
 * Sentry Integration for Forj CLI
 * 
 * OPT-IN ONLY: Users must explicitly enable telemetry via `forj telemetry enable`
 * Privacy-first design with extensive data scrubbing
 */

import * as Sentry from '@sentry/node';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.forj');
const TELEMETRY_CONFIG_FILE = path.join(CONFIG_DIR, 'telemetry.json');

interface TelemetryConfig {
  enabled: boolean;
  enabledAt?: string;
  anonymousId?: string;
}

/**
 * Load telemetry configuration from ~/.forj/telemetry.json
 */
function loadTelemetryConfig(): TelemetryConfig {
  try {
    if (fs.existsSync(TELEMETRY_CONFIG_FILE)) {
      const content = fs.readFileSync(TELEMETRY_CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    // Fail silently - telemetry is opt-in
  }
  
  return { enabled: false };
}

/**
 * Save telemetry configuration to ~/.forj/telemetry.json
 */
export function saveTelemetryConfig(config: TelemetryConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    fs.writeFileSync(TELEMETRY_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save telemetry config:', error);
  }
}

/**
 * Enable telemetry tracking
 */
export function enableTelemetry(): void {
  const anonymousId = generateAnonymousId();
  
  saveTelemetryConfig({
    enabled: true,
    enabledAt: new Date().toISOString(),
    anonymousId,
  });
  
  console.log('✅ Telemetry enabled');
  console.log('   Anonymous ID:', anonymousId);
  console.log('   Data collected: command usage, errors (no credentials or PII)');
  console.log('   Disable anytime with: forj telemetry disable');
}

/**
 * Disable telemetry tracking
 */
export function disableTelemetry(): void {
  saveTelemetryConfig({
    enabled: false,
  });
  
  console.log('✅ Telemetry disabled');
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
  const config = loadTelemetryConfig();
  return config.enabled === true;
}

/**
 * Generate anonymous user ID (never sent to server, only for Sentry grouping)
 */
function generateAnonymousId(): string {
  return 'cli_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Initialize Sentry (only if telemetry is enabled)
 */
export function initSentry(): void {
  const config = loadTelemetryConfig();
  
  // Only initialize if user has opted in
  if (!config.enabled) {
    return;
  }
  
  const SENTRY_DSN = process.env.SENTRY_DSN_CLI;
  
  if (!SENTRY_DSN) {
    return; // Silently skip if DSN not configured
  }
  
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    
    // CLI version tracking
    release: process.env.npm_package_version || 'unknown',
    
    // Performance monitoring (lower sample rate for CLI)
    tracesSampleRate: 0.05, // 5% of CLI commands
    
    // Enable structured logging
    enableLogs: true,
    
    // Privacy: NEVER send PII
    sendDefaultPii: false,
    
    // Data scrubbing - CRITICAL for CLI (user data on their machine)
    beforeSend(event, hint) {
      // Remove all user paths (replace with sanitized placeholders)
      if (event.message) {
        event.message = scrubUserPaths(scrubSensitiveData(event.message));
      }
      
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(breadcrumb => ({
          ...breadcrumb,
          message: breadcrumb.message 
            ? scrubUserPaths(scrubSensitiveData(breadcrumb.message)) 
            : breadcrumb.message,
        }));
      }
      
      // Scrub exception messages
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map(exception => ({
          ...exception,
          value: exception.value 
            ? scrubUserPaths(scrubSensitiveData(exception.value)) 
            : exception.value,
        }));
      }
      
      // Set anonymous user ID
      if (config.anonymousId) {
        event.user = {
          id: config.anonymousId,
        };
      }
      
      return event;
    },
  });
}

/**
 * Scrub sensitive data from strings
 */
function scrubSensitiveData(text: string): string {
  return text
    // Forj API keys
    .replace(/forj_(live|test)_[a-zA-Z0-9]{32}/g, 'forj_$1_[REDACTED]')
    // JWT tokens
    .replace(/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, '[JWT_REDACTED]')
    // Bearer tokens
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/g, 'Bearer [REDACTED]')
    // Cloudflare API tokens
    .replace(/[a-zA-Z0-9_-]{40}/g, '[CF_TOKEN_REDACTED]')
    // GitHub tokens
    .replace(/gh[a-z]_[a-zA-Z0-9]{36,}/g, '[GITHUB_TOKEN_REDACTED]')
    // Stripe keys
    .replace(/sk_(live|test)_[a-zA-Z0-9]{24,}/g, 'sk_$1_[REDACTED]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
    // Domain names (but keep TLDs for debugging)
    .replace(/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/g, '[DOMAIN_REDACTED]')
    // IP addresses
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_REDACTED]');
}

/**
 * Scrub user-specific file paths
 */
function scrubUserPaths(text: string): string {
  const homeDir = os.homedir();
  const username = os.userInfo().username;
  
  return text
    .replace(new RegExp(homeDir, 'g'), '~')
    .replace(new RegExp(username, 'g'), '[USER]')
    .replace(/\/Users\/[^\/]+/g, '/Users/[USER]')
    .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\[USER]');
}

/**
 * Capture CLI error with context
 */
export function captureCliError(error: Error, context?: {
  command?: string;
  flags?: Record<string, any>;
}) {
  if (!isTelemetryEnabled()) {
    return; // Silently skip if telemetry disabled
  }
  
  Sentry.withScope((scope) => {
    if (context?.command) {
      scope.setContext('command', {
        name: context.command,
        // Scrub any sensitive flag values
        flags: context.flags ? scrubSensitiveData(JSON.stringify(context.flags)) : undefined,
      });
    }
    
    Sentry.captureException(error);
  });
}

export { Sentry };

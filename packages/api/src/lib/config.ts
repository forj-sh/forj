/**
 * Production configuration and environment validation
 *
 * Reference: Stripe API documentation, project configuration docs
 *
 * Validates required environment variables and provides typed configuration.
 *
 * INTEGRATION STATUS:
 * This module is NOT YET USED by the API server. It will be integrated when:
 * - Server initialization is refactored to use centralized config
 * - Environment variable handling is standardized
 * - Current inline process.env access is replaced
 *
 * NOTE: Current codebase uses REDIS_URL (packages/api/src/lib/redis.ts) but this
 * config expects REDIS_HOST/REDIS_PORT. When integrating, align env var names.
 */

import type { NamecheapConfig, StripeConfig, DomainWorkerConfig } from '@forj/shared';

/**
 * Environment type
 */
export type Environment = 'development' | 'staging' | 'production';

/**
 * Application configuration
 */
export interface AppConfig {
  /** Environment */
  env: Environment;
  /** Server port */
  port: number;
  /** API base URL */
  apiUrl: string;
  /** Redis configuration */
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  /** Database configuration */
  database: {
    url: string;
  };
  /** Namecheap configuration */
  namecheap: NamecheapConfig;
  /** Stripe configuration */
  stripe: StripeConfig;
  /** Domain worker configuration */
  domainWorker: DomainWorkerConfig;
  /** Rate limiting */
  rateLimiting: {
    enabled: boolean;
    maxRequestsPerMinute: number;
  };
}

/**
 * Required environment variables
 *
 * NOTE: NODE_ENV and PORT are not required (have defaults in loadConfig)
 */
const REQUIRED_ENV_VARS = [
  'API_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'DATABASE_URL',
  'NAMECHEAP_API_USER',
  'NAMECHEAP_API_KEY',
  'NAMECHEAP_USERNAME',
  'NAMECHEAP_CLIENT_IP',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_ENV_VARS = {
  REDIS_PASSWORD: undefined,
  NAMECHEAP_SANDBOX: 'true',
  STRIPE_SUCCESS_URL: 'https://forj.sh/success',
  STRIPE_CANCEL_URL: 'https://forj.sh/checkout',
  RATE_LIMITING_ENABLED: 'true',
  RATE_LIMITING_MAX_REQUESTS: '100',
  DOMAIN_WORKER_CONCURRENCY: '5',
} as const;

/**
 * Validate environment variables
 *
 * @throws Error if required variables are missing
 */
export function validateEnvironment(): void {
  const missing: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join('\n')}`
    );
  }
}

/**
 * Get environment variable or default
 *
 * Returns undefined if not set and no default provided.
 * Use this for optional env vars to avoid empty strings.
 */
function getEnvVar(name: string, defaultValue?: string): string | undefined {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }
  return defaultValue;
}

/**
 * Get required environment variable
 *
 * Throws error if not set.
 */
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable not set: ${name}`);
  }
  return value;
}

/**
 * Get boolean environment variable
 */
function getBooleanEnvVar(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Get number environment variable
 */
function getNumberEnvVar(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load application configuration from environment
 *
 * @returns Typed configuration object
 * @throws Error if validation fails
 */
export function loadConfig(): AppConfig {
  // Validate required vars first
  validateEnvironment();

  const env = (process.env.NODE_ENV || 'development') as Environment;
  const isProduction = env === 'production';

  // Get Redis password (optional - only set if non-empty)
  const redisPassword = getEnvVar('REDIS_PASSWORD');

  return {
    env,
    port: getNumberEnvVar('PORT', 3000),
    apiUrl: getRequiredEnvVar('API_URL'),
    redis: {
      host: getRequiredEnvVar('REDIS_HOST'),
      port: getNumberEnvVar('REDIS_PORT', 6379),
      ...(redisPassword ? { password: redisPassword } : {}), // Only include if non-empty
    },
    database: {
      url: getRequiredEnvVar('DATABASE_URL'),
    },
    namecheap: {
      apiUser: getRequiredEnvVar('NAMECHEAP_API_USER'),
      apiKey: getRequiredEnvVar('NAMECHEAP_API_KEY'),
      userName: getRequiredEnvVar('NAMECHEAP_USERNAME'),
      clientIp: getRequiredEnvVar('NAMECHEAP_CLIENT_IP'),
      sandbox: getBooleanEnvVar('NAMECHEAP_SANDBOX', !isProduction),
    },
    stripe: {
      secretKey: getRequiredEnvVar('STRIPE_SECRET_KEY'),
      webhookSecret: getRequiredEnvVar('STRIPE_WEBHOOK_SECRET'),
      successUrl: getEnvVar('STRIPE_SUCCESS_URL', OPTIONAL_ENV_VARS.STRIPE_SUCCESS_URL)!,
      cancelUrl: getEnvVar('STRIPE_CANCEL_URL', OPTIONAL_ENV_VARS.STRIPE_CANCEL_URL)!,
    },
    domainWorker: {
      namecheap: {
        apiUser: getRequiredEnvVar('NAMECHEAP_API_USER'),
        apiKey: getRequiredEnvVar('NAMECHEAP_API_KEY'),
        userName: getRequiredEnvVar('NAMECHEAP_USERNAME'),
        clientIp: getRequiredEnvVar('NAMECHEAP_CLIENT_IP'),
        sandbox: getBooleanEnvVar('NAMECHEAP_SANDBOX', !isProduction),
      },
      redis: {
        host: getRequiredEnvVar('REDIS_HOST'),
        port: getNumberEnvVar('REDIS_PORT', 6379),
        ...(redisPassword ? { password: redisPassword } : {}),
      },
      queue: {
        name: 'domain-jobs',
        concurrency: getNumberEnvVar('DOMAIN_WORKER_CONCURRENCY', 5),
        retry: {
          maxAttempts: 3,
          backoffType: 'exponential',
          backoffDelay: 5000,
        },
      },
    },
    rateLimiting: {
      enabled: getBooleanEnvVar('RATE_LIMITING_ENABLED', isProduction),
      maxRequestsPerMinute: getNumberEnvVar('RATE_LIMITING_MAX_REQUESTS', 100),
    },
  };
}

/**
 * Print configuration (redacted sensitive values)
 */
export function printConfig(config: AppConfig): void {
  console.log('\n=== Application Configuration ===');
  console.log(`Environment: ${config.env}`);
  console.log(`Port: ${config.port}`);
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Redis: ${config.redis.host}:${config.redis.port}`);
  console.log(`Database: ${redactUrl(config.database.url)}`);
  console.log(`Namecheap: ${config.namecheap.sandbox ? 'SANDBOX' : 'PRODUCTION'}`);
  console.log(`Stripe: ${redactKey(config.stripe.secretKey)}`);
  console.log(`Rate Limiting: ${config.rateLimiting.enabled ? 'enabled' : 'disabled'}`);
  console.log('=================================\n');
}

/**
 * Redact sensitive URL (hide credentials)
 */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      return url.replace(parsed.password, '***');
    }
    return url;
  } catch {
    return '***';
  }
}

/**
 * Redact API key (show first/last 4 chars)
 */
function redactKey(key: string): string {
  if (key.length < 12) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

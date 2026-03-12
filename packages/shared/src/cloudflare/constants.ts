/**
 * Cloudflare API constants
 */

/**
 * Cloudflare API base URL
 */
export const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';

/**
 * Request timeout in milliseconds (30 seconds)
 */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * User agent for API requests
 */
export const USER_AGENT = 'Forj/1.0 (https://forj.sh)';

/**
 * Rate limits for Cloudflare API
 * Reference: https://developers.cloudflare.com/fundamentals/api/reference/limits/
 */
export const RATE_LIMITS = {
  /** Authenticated requests: 1200 requests per 5 minutes */
  AUTHENTICATED: {
    requests: 1200,
    window: 5 * 60 * 1000, // 5 minutes in ms
  },
  /** Unauthenticated requests: 100 requests per 5 minutes */
  UNAUTHENTICATED: {
    requests: 100,
    window: 5 * 60 * 1000, // 5 minutes in ms
  },
};

/**
 * Default TTL for DNS records (1 = automatic)
 */
export const DEFAULT_DNS_TTL = 1;

/**
 * Cloudflare nameserver suffixes
 * Cloudflare assigns nameservers like ns1.cloudflare.com, ns2.cloudflare.com
 */
export const CLOUDFLARE_NS_PATTERN = /^ns\d+\.cloudflare\.com$/i;

/**
 * Namecheap API constants
 */

/**
 * Namecheap API URLs
 */
export const NAMECHEAP_URLS = {
  PRODUCTION: 'https://api.namecheap.com/xml.response',
  SANDBOX: 'https://api.sandbox.namecheap.com/xml.response',
} as const;

/**
 * Global request parameters required for every Namecheap API call
 */
export const GLOBAL_PARAMS = [
  'ApiUser',
  'ApiKey',
  'UserName',
  'ClientIp',
  'Command',
] as const;

/**
 * HTTP timeout for Namecheap API requests (in milliseconds)
 */
export const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

/**
 * User agent for Namecheap API requests
 */
export const USER_AGENT = 'Forj/0.1.0 (Node.js)';

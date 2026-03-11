/**
 * @forj/shared/cloudflare - Cloudflare API client
 *
 * TypeScript client for Cloudflare API v4
 * Reference: https://developers.cloudflare.com/api/
 */

// Types
export type {
  CloudflareConfig,
  CloudflareApiResponse,
  CloudflareResultInfo,
  CloudflareApiError as CloudflareApiErrorType,
  CloudflareZone,
  ZoneStatus,
  ZoneType,
  DNSRecordType,
  DNSRecord,
  DNSRecordInput,
  ZoneCreateParams,
  TokenVerification,
  TokenPolicy,
  PermissionGroup,
  TokenCondition,
  CloudflareAccount,
} from './types.js';

// Errors
export {
  CloudflareApiError,
  CloudflareErrorCategory,
  categorizeError,
  ERROR_CODE_MAP,
} from './errors.js';

// Client
export { CloudflareClient } from './client.js';

// Constants
export {
  CLOUDFLARE_API_URL,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  RATE_LIMITS,
  DEFAULT_DNS_TTL,
  CLOUDFLARE_NS_PATTERN,
} from './constants.js';

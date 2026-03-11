/**
 * Cloudflare API TypeScript types
 *
 * Based on Cloudflare API v4 specification:
 * https://developers.cloudflare.com/api/
 */

/**
 * Cloudflare client configuration
 */
export interface CloudflareConfig {
  apiToken: string;     // Cloudflare API token (not API key)
  accountId?: string;   // Optional account ID for account-scoped operations
}

/**
 * Generic Cloudflare API response envelope
 *
 * All Cloudflare API responses follow this structure
 */
export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: CloudflareApiError[];
  messages: string[];
  result: T;
  result_info?: CloudflareResultInfo;
}

/**
 * Pagination info for list responses
 */
export interface CloudflareResultInfo {
  page: number;
  per_page: number;
  total_pages: number;
  count: number;
  total_count: number;
}

/**
 * Cloudflare API error object
 */
export interface CloudflareApiError {
  code: number;
  message: string;
  error_chain?: CloudflareApiError[];
}

/**
 * Cloudflare zone (domain)
 */
export interface CloudflareZone {
  id: string;
  name: string;                     // Domain name (e.g., "example.com")
  status: ZoneStatus;
  paused: boolean;
  type: ZoneType;
  development_mode: number;
  name_servers: string[];           // Cloudflare nameservers assigned to this zone
  original_name_servers: string[];  // Original nameservers before Cloudflare
  original_registrar: string | null;
  original_dnshost: string | null;
  created_on: string;               // ISO 8601 timestamp
  modified_on: string;              // ISO 8601 timestamp
  activated_on: string | null;      // ISO 8601 timestamp
  account: {
    id: string;
    name: string;
  };
  owner: {
    id: string;
    type: string;
    email: string;
  };
  permissions: string[];
  plan: {
    id: string;
    name: string;
    price: number;
    currency: string;
    frequency: string;
    is_subscribed: boolean;
    can_subscribe: boolean;
  };
}

/**
 * Zone status
 */
export type ZoneStatus =
  | 'active'          // Zone is active and serving traffic
  | 'pending'         // Zone is pending activation
  | 'initializing'    // Zone is being set up
  | 'moved'           // Zone has been moved to another account
  | 'deleted'         // Zone has been deleted
  | 'deactivated';    // Zone has been deactivated

/**
 * Zone type
 */
export type ZoneType =
  | 'full'            // Full setup (nameservers point to Cloudflare)
  | 'partial'         // Partial setup (CNAME setup)
  | 'secondary';      // Secondary DNS

/**
 * DNS record types supported by Cloudflare
 */
export type DNSRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'TXT'
  | 'NS'
  | 'SRV'
  | 'CAA'
  | 'PTR'
  | 'CERT'
  | 'DNSKEY'
  | 'DS'
  | 'NAPTR'
  | 'SMIMEA'
  | 'SSHFP'
  | 'TLSA'
  | 'URI'
  | 'LOC'
  | 'SVCB'
  | 'HTTPS';

/**
 * DNS record
 */
export interface DNSRecord {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;                   // Full DNS name (e.g., "www.example.com")
  type: DNSRecordType;
  content: string;                // Record value (IP, hostname, etc.)
  proxiable: boolean;             // Can this record be proxied through Cloudflare?
  proxied: boolean;               // Is this record proxied?
  ttl: number;                    // TTL in seconds (1 = automatic)
  locked: boolean;
  created_on: string;             // ISO 8601 timestamp
  modified_on: string;            // ISO 8601 timestamp
  data?: Record<string, unknown>; // Additional data for SRV, CAA, etc.
  meta?: {
    auto_added: boolean;
    managed_by_apps: boolean;
    managed_by_argo_tunnel: boolean;
  };
  priority?: number;              // MX/SRV priority
  comment?: string;               // Comment for the record
  tags?: string[];                // Tags for the record
}

/**
 * DNS record input for creation/update
 */
export interface DNSRecordInput {
  type: DNSRecordType;
  name: string;                   // DNS name (can be relative to zone, e.g., "www" or "@")
  content: string;                // Record value
  ttl?: number;                   // TTL in seconds (1 = automatic, default)
  priority?: number;              // MX/SRV priority
  proxied?: boolean;              // Proxy through Cloudflare (default: false)
  comment?: string;               // Comment for the record
  tags?: string[];                // Tags for the record
}

/**
 * Zone creation parameters
 */
export interface ZoneCreateParams {
  name: string;                   // Domain name (e.g., "example.com")
  account: {
    id: string;                   // Account ID
  };
  jump_start?: boolean;           // Auto-scan for DNS records (default: false)
  type?: ZoneType;                // Zone type (default: 'full')
}

/**
 * Token verification result
 */
export interface TokenVerification {
  id: string;
  status: 'active' | 'disabled' | 'expired';
  not_before?: string;            // ISO 8601 timestamp
  expires_on?: string;            // ISO 8601 timestamp
  policies: TokenPolicy[];
  condition?: TokenCondition;
}

/**
 * Token policy
 */
export interface TokenPolicy {
  id: string;
  effect: 'allow' | 'deny';
  resources: Record<string, string>;
  permission_groups: PermissionGroup[];
}

/**
 * Permission group
 */
export interface PermissionGroup {
  id: string;
  name: string;
}

/**
 * Token condition
 */
export interface TokenCondition {
  request_ip?: {
    in?: string[];
    not_in?: string[];
  };
}

/**
 * Account information
 */
export interface CloudflareAccount {
  id: string;
  name: string;
  type: 'standard' | 'enterprise';
  created_on: string;             // ISO 8601 timestamp
  settings: {
    enforce_twofactor: boolean;
  };
}

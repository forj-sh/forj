/**
 * DNS-related types
 */

/**
 * DNS record types
 */
export type DNSRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA';

/**
 * DNS record status
 */
export type DNSRecordStatus = 'valid' | 'invalid' | 'missing';

/**
 * DNS health status
 */
export type DNSHealthStatus = 'healthy' | 'degraded' | 'critical';

/**
 * DNS record
 */
export interface DNSRecord {
  type: DNSRecordType;
  name: string;
  value: string;
  status: DNSRecordStatus;
  error?: string;
}

/**
 * DNS health check result
 * GET /projects/:id/dns/health
 */
export interface DNSHealthResult {
  domain: string;
  overall: DNSHealthStatus;
  records: DNSRecord[];
  checkedAt: string;
}

/**
 * DNS fix request
 * POST /projects/:id/dns/fix
 */
export interface DNSFixRequest {
  records?: DNSRecordType[];
}

/**
 * DNS fix response
 */
export interface DNSFixResponse {
  fixed: string[];
  failed: string[];
}

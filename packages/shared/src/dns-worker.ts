/**
 * DNS wiring worker types and state machine
 *
 * Defines job data, states, and transitions for DNS record provisioning operations.
 * This worker auto-configures essential DNS records (MX, SPF, DKIM, DMARC, CNAME).
 */

/**
 * DNS operation types
 */
export enum DNSOperationType {
  WIRE_RECORDS = 'WIRE_RECORDS',
  VERIFY_RECORDS = 'VERIFY_RECORDS',
}

/**
 * DNS job status (matches state machine)
 */
export enum DNSJobStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  WIRING_MX = 'wiring_mx',
  WIRING_SPF = 'wiring_spf',
  WIRING_DKIM = 'wiring_dkim',
  WIRING_DMARC = 'wiring_dmarc',
  WIRING_CNAME = 'wiring_cname',
  WIRING_COMPLETE = 'wiring_complete',
  VERIFYING = 'verifying',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * Email provider for MX/SPF configuration
 */
export enum EmailProvider {
  GOOGLE_WORKSPACE = 'google_workspace',
  MICROSOFT_365 = 'microsoft_365',
  CUSTOM = 'custom',
}

/**
 * Base job data for all DNS operations
 */
export interface BaseDNSJobData {
  userId: string;
  projectId: string;
  domain: string;
  zoneId: string;
  cloudflareApiToken: string;
}

/**
 * Wire DNS records job data
 */
export interface WireDNSRecordsJobData extends BaseDNSJobData {
  operation: DNSOperationType.WIRE_RECORDS;
  emailProvider: EmailProvider;
  customMXRecords?: Array<{ priority: number; value: string }>;
  customSPF?: string;
  dkimSelectors?: string[]; // For Google Workspace DKIM
  githubOrg?: string; // For GitHub Pages CNAME
  vercelDomain?: string; // For Vercel CNAME
  customCNAMEs?: Array<{ name: string; value: string }>;
}

/**
 * Verify DNS records job data
 */
export interface VerifyDNSRecordsJobData extends BaseDNSJobData {
  operation: DNSOperationType.VERIFY_RECORDS;
  expectedRecords: Array<{
    type: string;
    name: string;
    content: string;
  }>;
}

/**
 * Union type for all DNS job data
 */
export type DNSJobData = WireDNSRecordsJobData | VerifyDNSRecordsJobData;

/**
 * DNS worker configuration
 */
export interface DNSWorkerConfig {
  redis: {
    host: string;
    port: number;
  };
  concurrency?: number;
  eventPublisher?: IWorkerEventPublisher;
}

/**
 * DNS worker event types
 */
export enum DNSWorkerEventType {
  MX_WIRING_STARTED = 'dns.mx.wiring.started',
  MX_WIRING_COMPLETE = 'dns.mx.wiring.complete',
  SPF_WIRING_STARTED = 'dns.spf.wiring.started',
  SPF_WIRING_COMPLETE = 'dns.spf.wiring.complete',
  DKIM_WIRING_STARTED = 'dns.dkim.wiring.started',
  DKIM_WIRING_COMPLETE = 'dns.dkim.wiring.complete',
  DMARC_WIRING_STARTED = 'dns.dmarc.wiring.started',
  DMARC_WIRING_COMPLETE = 'dns.dmarc.wiring.complete',
  CNAME_WIRING_STARTED = 'dns.cname.wiring.started',
  CNAME_WIRING_COMPLETE = 'dns.cname.wiring.complete',
  WIRING_COMPLETE = 'dns.wiring.complete',
  VERIFICATION_STARTED = 'dns.verification.started',
  VERIFICATION_COMPLETE = 'dns.verification.complete',
  VERIFICATION_FAILED = 'dns.verification.failed',
  WIRING_FAILED = 'dns.wiring.failed',
}

/**
 * DNS worker event
 */
export interface DNSWorkerEvent {
  type: DNSWorkerEventType;
  projectId: string;
  userId: string;
  jobId: string;
  timestamp: string;
  data: {
    domain?: string;
    zoneId?: string;
    recordType?: string;
    recordsCreated?: number;
    error?: string;
    status?: DNSJobStatus;
    [key: string]: unknown;
  };
}

/**
 * Worker event publisher interface
 */
export interface IWorkerEventPublisher {
  publishEvent(event: DNSWorkerEvent): Promise<void>;
}

/**
 * DNS state machine transitions
 *
 * Defines valid state transitions for DNS operations.
 */
export const DNS_STATE_TRANSITIONS: Record<DNSJobStatus, DNSJobStatus[]> = {
  [DNSJobStatus.PENDING]: [DNSJobStatus.QUEUED, DNSJobStatus.FAILED],
  [DNSJobStatus.QUEUED]: [DNSJobStatus.WIRING_MX, DNSJobStatus.VERIFYING, DNSJobStatus.FAILED],
  [DNSJobStatus.WIRING_MX]: [DNSJobStatus.WIRING_SPF, DNSJobStatus.FAILED],
  [DNSJobStatus.WIRING_SPF]: [DNSJobStatus.WIRING_DKIM, DNSJobStatus.WIRING_DMARC, DNSJobStatus.FAILED],
  [DNSJobStatus.WIRING_DKIM]: [DNSJobStatus.WIRING_DMARC, DNSJobStatus.FAILED],
  [DNSJobStatus.WIRING_DMARC]: [DNSJobStatus.WIRING_CNAME, DNSJobStatus.WIRING_COMPLETE, DNSJobStatus.FAILED],
  [DNSJobStatus.WIRING_CNAME]: [DNSJobStatus.WIRING_COMPLETE, DNSJobStatus.FAILED],
  [DNSJobStatus.WIRING_COMPLETE]: [DNSJobStatus.VERIFYING, DNSJobStatus.COMPLETE, DNSJobStatus.FAILED],
  [DNSJobStatus.VERIFYING]: [DNSJobStatus.COMPLETE, DNSJobStatus.FAILED],
  [DNSJobStatus.COMPLETE]: [],
  [DNSJobStatus.FAILED]: [],
};

/**
 * Check if state transition is valid
 */
export function isValidStateTransition(
  currentState: DNSJobStatus,
  nextState: DNSJobStatus
): boolean {
  const validTransitions = DNS_STATE_TRANSITIONS[currentState];
  return validTransitions.includes(nextState);
}

/**
 * Check if state is terminal (no further transitions)
 */
export function isTerminalState(state: DNSJobStatus): boolean {
  return state === DNSJobStatus.COMPLETE || state === DNSJobStatus.FAILED;
}

/**
 * Check if state is retryable
 */
export function isRetryableState(state: DNSJobStatus): boolean {
  // Only failed states are retryable
  return state === DNSJobStatus.FAILED;
}

/**
 * Default MX records for email providers
 */
export const DEFAULT_MX_RECORDS = {
  [EmailProvider.GOOGLE_WORKSPACE]: [
    { priority: 1, value: 'aspmx.l.google.com' },
    { priority: 5, value: 'alt1.aspmx.l.google.com' },
    { priority: 5, value: 'alt2.aspmx.l.google.com' },
    { priority: 10, value: 'alt3.aspmx.l.google.com' },
    { priority: 10, value: 'alt4.aspmx.l.google.com' },
  ],
  [EmailProvider.MICROSOFT_365]: [
    { priority: 0, value: '<domain>.mail.protection.outlook.com' }, // Replace <domain> at runtime
  ],
} as const;

/**
 * Default SPF records for email providers
 */
export const DEFAULT_SPF_RECORDS = {
  [EmailProvider.GOOGLE_WORKSPACE]: 'v=spf1 include:_spf.google.com ~all',
  [EmailProvider.MICROSOFT_365]: 'v=spf1 include:spf.protection.outlook.com ~all',
} as const;

/**
 * Default DMARC record (relaxed policy for startups)
 */
export const DEFAULT_DMARC_RECORD = (domain: string) =>
  `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; ruf=mailto:dmarc@${domain}; fo=1`;

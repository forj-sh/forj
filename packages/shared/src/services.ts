/**
 * Service state enums and types
 */

/**
 * Service status values
 */
export type ServiceStatus = 'pending' | 'running' | 'complete' | 'failed';

/**
 * Service display status (for CLI)
 */
export type ServiceDisplayStatus = 'active' | 'pending' | 'failed' | 'not_provisioned';

/**
 * Available services that can be provisioned
 */
export type ServiceType =
  | 'domain'
  | 'github'
  | 'cloudflare'
  | 'dns'
  | 'vercel'
  | 'railway'
  | 'google-workspace';

/**
 * Service state in JSONB project.services column
 */
export interface ServiceState {
  status: ServiceStatus;
  value?: string;
  meta?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

/**
 * Service status for display (from status command)
 */
export interface ServiceStatusDisplay {
  status: ServiceDisplayStatus;
  value?: string;
  detail?: string;
  updatedAt?: string;
}

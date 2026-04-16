/**
 * @forj/shared/vercel - Vercel API client
 *
 * TypeScript client for Vercel REST API
 * Reference: https://vercel.com/docs/rest-api
 */

// Types
export type {
  VercelConfig,
  VercelApiErrorDetail,
  VercelUser,
  VercelTeam,
  VercelProject,
  VercelGitRepository,
  VercelGitLink,
  VercelDeployment,
  VercelDomain,
  VercelDomainVerification,
  VercelDomainConfig,
  VercelGitNamespace,
  ProjectCreateParams,
} from './types.js';

// Errors
export {
  VercelApiError,
  VercelErrorCategory,
  categorizeByStatus,
} from './errors.js';

// Client
export { VercelClient } from './client.js';

// Constants
export {
  VERCEL_API_URL,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  VERCEL_CNAME_TARGET,
  VERCEL_A_RECORDS,
} from './constants.js';

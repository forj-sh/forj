/**
 * Vercel API TypeScript types
 *
 * Based on Vercel REST API specification:
 * https://vercel.com/docs/rest-api
 */

/**
 * Vercel client configuration
 */
export interface VercelConfig {
  token: string;
  teamId?: string;
}

/**
 * Vercel API error object
 */
export interface VercelApiErrorDetail {
  code: string;
  message: string;
}

/**
 * Vercel user (from GET /v2/user)
 */
export interface VercelUser {
  id: string;
  email: string;
  name: string | null;
  username: string;
  avatar: string | null;
  defaultTeamId: string | null;
}

/**
 * Vercel team
 */
export interface VercelTeam {
  id: string;
  slug: string;
  name: string | null;
  avatar: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Vercel project
 */
export interface VercelProject {
  id: string;
  name: string;
  accountId: string;
  framework: string | null;
  devCommand: string | null;
  installCommand: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  rootDirectory: string | null;
  nodeVersion: string;
  link?: VercelGitLink;
  latestDeployments?: VercelDeployment[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Git repository link for project creation
 */
export interface VercelGitRepository {
  type: 'github';
  repo: string; // 'org/name' format
}

/**
 * Git link on an existing project
 */
export interface VercelGitLink {
  type: 'github';
  repo: string;
  repoId: number;
  org: string;
  repoOwnerId: number;
  gitCredentialId: string;
  productionBranch: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Vercel deployment (minimal)
 */
export interface VercelDeployment {
  id: string;
  url: string;
  state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
  readyState: string;
  createdAt: number;
}

/**
 * Vercel domain configuration
 */
export interface VercelDomain {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  verification?: VercelDomainVerification[];
  gitBranch: string | null;
  redirect: string | null;
  redirectStatusCode: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Domain verification record
 */
export interface VercelDomainVerification {
  type: string;   // 'TXT' or 'CNAME'
  domain: string;  // Where to add the record
  value: string;   // Record value
  reason: string;  // Why this verification is needed
}

/**
 * Domain configuration (DNS records to add)
 */
export interface VercelDomainConfig {
  configuredBy: 'CNAME' | 'A' | null;
  acceptedChallenges: string[];
  misconfigured: boolean;
}

/**
 * Project creation parameters
 */
export interface ProjectCreateParams {
  name: string;
  framework?: string | null;
  gitRepository?: VercelGitRepository;
  buildCommand?: string | null;
  devCommand?: string | null;
  installCommand?: string | null;
  outputDirectory?: string | null;
  rootDirectory?: string | null;
}

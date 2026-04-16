/**
 * Vercel API client
 *
 * TypeScript client for Vercel REST API
 * Reference: https://vercel.com/docs/rest-api
 */

import { VercelApiError, VercelErrorCategory } from './errors.js';
import { VERCEL_API_URL, REQUEST_TIMEOUT_MS, USER_AGENT } from './constants.js';
import type {
  VercelConfig,
  VercelUser,
  VercelTeam,
  VercelProject,
  VercelDomain,
  VercelDomainConfig,
  VercelGitNamespace,
  ProjectCreateParams,
} from './types.js';

/**
 * Vercel API client
 */
export class VercelClient {
  private readonly config: VercelConfig;
  private readonly baseUrl: string;

  constructor(config: VercelConfig) {
    this.config = config;
    this.baseUrl = VERCEL_API_URL;
  }

  /**
   * Execute an API request with retry-on-429
   */
  private async executeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 3,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Append teamId to URL if set
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = this.config.teamId
      ? `${url}${separator}teamId=${encodeURIComponent(this.config.teamId)}`
      : url;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const { headers: _ignoredHeaders, ...optionsWithoutHeaders } = options;
      const headers = new Headers(options.headers ?? {});
      headers.set('Authorization', `Bearer ${this.config.token}`);
      headers.set('Content-Type', 'application/json');
      headers.set('User-Agent', USER_AGENT);

      const response = await fetch(fullUrl, {
        ...optionsWithoutHeaders,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retry on 429
      if (response.status === 429 && retries > 0) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
        await new Promise(resolve => setTimeout(resolve, retryAfterMs));
        return this.executeRequest<T>(endpoint, options, retries - 1);
      }

      if (!response.ok) {
        let errorDetail = { code: 'UNKNOWN', message: response.statusText };
        try {
          const errorBody = await response.json() as { error?: { code: string; message: string } };
          if (errorBody.error) {
            errorDetail = errorBody.error;
          }
        } catch {
          // Use default error detail
        }
        throw new VercelApiError(response.status, errorDetail);
      }

      // Some endpoints return empty bodies (204)
      if (response.status === 204) {
        return {} as T;
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof VercelApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new VercelApiError(
          0,
          { code: 'TIMEOUT', message: 'Request timeout: Vercel API did not respond in time' },
          VercelErrorCategory.NETWORK,
        );
      }

      throw new VercelApiError(
        0,
        { code: 'NETWORK', message: (error as Error).message },
        VercelErrorCategory.NETWORK,
      );
    }
  }

  /**
   * Get authenticated user
   *
   * Endpoint: GET /v2/user
   */
  async getUser(): Promise<VercelUser> {
    const response = await this.executeRequest<{ user: VercelUser }>('/v2/user');
    return response.user;
  }

  /**
   * List teams the user has access to
   *
   * Endpoint: GET /v2/teams
   */
  async listTeams(): Promise<VercelTeam[]> {
    const response = await this.executeRequest<{ teams: VercelTeam[] }>('/v2/teams');
    return response.teams;
  }

  /**
   * Get team details
   *
   * Endpoint: GET /v2/teams/:teamId
   */
  async getTeam(teamId: string): Promise<VercelTeam> {
    return this.executeRequest<VercelTeam>(`/v2/teams/${encodeURIComponent(teamId)}`);
  }

  /**
   * Create a project
   *
   * Endpoint: POST /v9/projects
   *
   * If gitRepository is provided, Vercel automatically links to the repo
   * and triggers an initial deployment from the default branch.
   */
  async createProject(params: ProjectCreateParams): Promise<VercelProject> {
    return this.executeRequest<VercelProject>('/v9/projects', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get a project by name or ID
   *
   * Endpoint: GET /v9/projects/:nameOrId
   */
  async getProject(nameOrId: string): Promise<VercelProject> {
    return this.executeRequest<VercelProject>(`/v9/projects/${encodeURIComponent(nameOrId)}`);
  }

  /**
   * Add a custom domain to a project
   *
   * Endpoint: POST /v10/projects/:projectId/domains
   *
   * Returns the domain config including DNS records that need to be created.
   */
  async addDomain(projectId: string, domain: string): Promise<VercelDomain> {
    return this.executeRequest<VercelDomain>(`/v10/projects/${encodeURIComponent(projectId)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    });
  }

  /**
   * Get domains for a project
   *
   * Endpoint: GET /v10/projects/:projectId/domains
   */
  async getDomains(projectId: string): Promise<VercelDomain[]> {
    const response = await this.executeRequest<{ domains: VercelDomain[] }>(
      `/v10/projects/${encodeURIComponent(projectId)}/domains`,
    );
    return response.domains;
  }

  /**
   * Get domain configuration (DNS verification status)
   *
   * Endpoint: GET /v6/domains/:domain/config
   */
  async getDomainConfig(domain: string): Promise<VercelDomainConfig> {
    return this.executeRequest<VercelDomainConfig>(
      `/v6/domains/${encodeURIComponent(domain)}/config`,
    );
  }

  /**
   * Verify a domain on a project
   *
   * Endpoint: POST /v10/projects/:projectId/domains/:domain/verify
   */
  async verifyDomain(projectId: string, domain: string): Promise<VercelDomain> {
    return this.executeRequest<VercelDomain>(
      `/v10/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}/verify`,
      { method: 'POST' },
    );
  }

  /**
   * List git namespaces (GitHub orgs/accounts) accessible to the Vercel account.
   *
   * Returns empty array if the Vercel GitHub integration is not installed
   * or has no accessible orgs/accounts.
   *
   * Endpoint: GET /v1/integrations/git-namespaces
   */
  async listGitNamespaces(provider: 'github' | 'gitlab' | 'bitbucket' = 'github'): Promise<VercelGitNamespace[]> {
    return this.executeRequest<VercelGitNamespace[]>(
      `/v1/integrations/git-namespaces?provider=${provider}`,
    );
  }

  /**
   * Check if the Vercel GitHub integration has access to a specific org.
   *
   * Returns true if the org is accessible (integration installed + granted access),
   * false otherwise.
   */
  async hasGitHubAccess(orgName: string): Promise<boolean> {
    try {
      const namespaces = await this.listGitNamespaces('github');
      return namespaces.some((ns) => ns.slug?.toLowerCase() === orgName.toLowerCase());
    } catch {
      return false;
    }
  }
}

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * Per RFC 7231, the header may be either a number of seconds (delta-seconds)
 * or an HTTP-date. Returns a bounded delay in ms; falls back to 5000ms on
 * unparseable or obviously-bogus values.
 */
function parseRetryAfter(header: string | null): number {
  const DEFAULT_MS = 5000;
  const MAX_MS = 60_000;

  if (!header) return DEFAULT_MS;

  // Try delta-seconds (integer)
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_MS);
  }

  // Try HTTP-date
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.min(delta, MAX_MS);
    return 0;
  }

  return DEFAULT_MS;
}

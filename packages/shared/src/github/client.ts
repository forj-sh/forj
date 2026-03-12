/**
 * GitHub REST API v3 client
 *
 * Reference: https://docs.github.com/en/rest
 */

import {
  GitHubConfig,
  GitHubOrg,
  GitHubRepo,
  RepoCreateParams,
  BranchProtectionParams,
  FileContent,
  GitHubPagesConfig,
  GitHubAuthenticatedUser,
} from './types.js';
import { createErrorFromResponse, createNetworkError, GitHubError } from './errors.js';
import { GITHUB_API_BASE_URL, FORJ_USER_AGENT } from './constants.js';

/**
 * GitHub API client
 */
export class GitHubClient {
  private readonly apiToken: string;
  private readonly baseUrl = GITHUB_API_BASE_URL;
  private readonly userAgent = FORJ_USER_AGENT;

  constructor(config: GitHubConfig) {
    this.apiToken = config.accessToken;
  }

  /**
   * Make authenticated request to GitHub API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    operation?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const operationName = operation || endpoint;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': this.userAgent,
      ...(options.headers as Record<string, string> || {}),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        throw await createErrorFromResponse(response, operationName);
      }

      // Handle 204 No Content responses
      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GitHubError) {
        throw error;
      }
      throw createNetworkError(operationName, error as Error);
    }
  }

  /**
   * Verify organization exists and user has access
   *
   * @param orgName - Organization name
   * @returns Organization details
   */
  async verifyOrg(orgName: string): Promise<GitHubOrg> {
    return this.request<GitHubOrg>(`/orgs/${orgName}`, {}, 'verify organization');
  }

  /**
   * List organization repositories
   *
   * @param orgName - Organization name
   * @param type - Repository type filter
   * @returns Array of repositories
   */
  async listRepos(
    orgName: string,
    type: 'all' | 'public' | 'private' | 'sources' | 'forks' = 'all'
  ): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>(`/orgs/${orgName}/repos?type=${type}&per_page=100`, {}, 'list repos');
  }

  /**
   * Create repository in organization
   *
   * @param orgName - Organization name
   * @param params - Repository creation parameters
   * @returns Created repository
   */
  async createRepo(orgName: string, params: RepoCreateParams): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/orgs/${orgName}/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    }, 'create repo');
  }

  /**
   * Get repository details
   *
   * @param owner - Repository owner (org or user)
   * @param repo - Repository name
   * @returns Repository details
   */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`, {}, 'get repo');
  }

  /**
   * Set branch protection rules
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param branch - Branch name
   * @param params - Protection parameters
   */
  async setBranchProtection(
    owner: string,
    repo: string,
    branch: string,
    params: BranchProtectionParams
  ): Promise<void> {
    // URL-encode branch name to handle slashes (e.g., "release/1.0")
    const encodedBranch = encodeURIComponent(branch);
    await this.request(`/repos/${owner}/${repo}/branches/${encodedBranch}/protection`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    }, 'set branch protection');
  }

  /**
   * Create or update file in repository
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param file - File content and metadata
   * @returns Commit details
   */
  async createFile(
    owner: string,
    repo: string,
    file: FileContent
  ): Promise<{ commit: { sha: string } }> {
    const content = Buffer.from(file.content).toString('base64');

    return this.request(`/repos/${owner}/${repo}/contents/${file.path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: file.message || `Add ${file.path}`,
        content,
        branch: file.branch,
      }),
    }, 'create file');
  }

  /**
   * Enable GitHub Pages for repository
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param config - Pages configuration
   * @returns Pages details
   */
  async configurePages(
    owner: string,
    repo: string,
    config: GitHubPagesConfig
  ): Promise<{ html_url: string }> {
    return this.request(`/repos/${owner}/${repo}/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.switcheroo-preview+json',
      },
      body: JSON.stringify(config),
    }, 'configure GitHub Pages');
  }

  /**
   * Get GitHub Pages status
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns Pages status
   */
  async getPagesStatus(
    owner: string,
    repo: string
  ): Promise<{ status: string; html_url: string }> {
    return this.request(`/repos/${owner}/${repo}/pages`, {
      headers: {
        Accept: 'application/vnd.github.switcheroo-preview+json',
      },
    }, 'get Pages status');
  }

  /**
   * Create multiple files in repository (batch operation)
   *
   * NOTE: This creates files sequentially, resulting in one commit per file.
   * For a true single-commit batch operation, use the GitHub Git Trees API instead.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param files - Array of files to create
   * @returns Array of commit SHAs
   */
  async createFiles(
    owner: string,
    repo: string,
    files: FileContent[]
  ): Promise<string[]> {
    const commits: string[] = [];

    for (const file of files) {
      const result = await this.createFile(owner, repo, file);
      commits.push(result.commit.sha);
    }

    return commits;
  }

  /**
   * Get authenticated user information
   *
   * @returns User details
   */
  async getAuthenticatedUser(): Promise<GitHubAuthenticatedUser> {
    return this.request('/user', {}, 'get authenticated user');
  }

  /**
   * Get repository topics (tags)
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns Array of topics
   */
  async getRepoTopics(owner: string, repo: string): Promise<{ names: string[] }> {
    return this.request(`/repos/${owner}/${repo}/topics`, {
      headers: {
        Accept: 'application/vnd.github.mercy-preview+json',
      },
    }, 'get repo topics');
  }

  /**
   * Set repository topics (tags)
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param topics - Array of topic names
   * @returns Updated topics
   */
  async setRepoTopics(owner: string, repo: string, topics: string[]): Promise<{ names: string[] }> {
    return this.request(`/repos/${owner}/${repo}/topics`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.mercy-preview+json',
      },
      body: JSON.stringify({ names: topics }),
    }, 'set repo topics');
  }
}

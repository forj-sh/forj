/**
 * GitHub API TypeScript types
 *
 * Based on GitHub REST API v3 specification:
 * https://docs.github.com/en/rest
 */

/**
 * GitHub client configuration
 */
export interface GitHubConfig {
  accessToken: string;     // GitHub OAuth token or Personal Access Token
}

/**
 * GitHub organization
 */
export interface GitHubOrg {
  login: string;
  id: number;
  node_id: string;
  url: string;
  repos_url: string;
  events_url: string;
  hooks_url: string;
  issues_url: string;
  members_url: string;
  public_members_url: string;
  avatar_url: string;
  description: string | null;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  is_verified: boolean;
  has_organization_projects: boolean;
  has_repository_projects: boolean;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  type: 'Organization';
}

/**
 * GitHub repository
 */
export interface GitHubRepo {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
    type: 'User' | 'Organization';
  };
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  archive_url: string;
  assignees_url: string;
  blobs_url: string;
  branches_url: string;
  collaborators_url: string;
  comments_url: string;
  commits_url: string;
  compare_url: string;
  contents_url: string;
  contributors_url: string;
  deployments_url: string;
  downloads_url: string;
  events_url: string;
  forks_url: string;
  git_commits_url: string;
  git_refs_url: string;
  git_tags_url: string;
  git_url: string;
  issue_comment_url: string;
  issue_events_url: string;
  issues_url: string;
  keys_url: string;
  labels_url: string;
  languages_url: string;
  merges_url: string;
  milestones_url: string;
  notifications_url: string;
  pulls_url: string;
  releases_url: string;
  ssh_url: string;
  stargazers_url: string;
  statuses_url: string;
  subscribers_url: string;
  subscription_url: string;
  tags_url: string;
  teams_url: string;
  trees_url: string;
  clone_url: string;
  mirror_url: string | null;
  hooks_url: string;
  svn_url: string;
  homepage: string | null;
  language: string | null;
  forks_count: number;
  stargazers_count: number;
  watchers_count: number;
  size: number;
  default_branch: string;
  open_issues_count: number;
  is_template: boolean;
  topics: string[];
  has_issues: boolean;
  has_projects: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_downloads: boolean;
  archived: boolean;
  disabled: boolean;
  visibility: 'public' | 'private' | 'internal';
  pushed_at: string;
  created_at: string;
  updated_at: string;
  permissions?: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

/**
 * Repository creation parameters
 */
export interface RepoCreateParams {
  name: string;
  description?: string;
  homepage?: string;
  private?: boolean;
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  is_template?: boolean;
  auto_init?: boolean;           // Initialize with README
  gitignore_template?: string;   // e.g., 'Node', 'Python', etc.
  license_template?: string;      // e.g., 'mit', 'apache-2.0', etc.
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  allow_auto_merge?: boolean;
  delete_branch_on_merge?: boolean;
}

/**
 * Branch protection rule parameters
 */
export interface BranchProtectionParams {
  required_status_checks?: {
    strict: boolean;
    contexts: string[];
  } | null;
  enforce_admins: boolean | null;
  required_pull_request_reviews?: {
    dismiss_stale_reviews?: boolean;
    require_code_owner_reviews?: boolean;
    required_approving_review_count?: number;
  } | null;
  restrictions?: {
    users: string[];
    teams: string[];
    apps: string[];
  } | null;
  required_linear_history?: boolean;
  allow_force_pushes?: boolean;
  allow_deletions?: boolean;
  block_creations?: boolean;
  required_conversation_resolution?: boolean;
}

/**
 * File content for repository
 */
export interface FileContent {
  path: string;
  content: string;
  message?: string;
  branch?: string;
}

/**
 * GitHub Pages configuration
 */
export interface GitHubPagesConfig {
  source: {
    branch: string;
    path: '/' | '/docs';
  };
  cname?: string;  // Custom domain
}

/**
 * Authenticated GitHub user
 */
export interface GitHubAuthenticatedUser {
  login: string;
  id: number;
  email: string | null;
}

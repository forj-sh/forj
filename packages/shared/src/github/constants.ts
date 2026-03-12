/**
 * GitHub API constants
 *
 * Reference: https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting
 */

/**
 * GitHub API base URL
 */
export const GITHUB_API_BASE_URL = 'https://api.github.com';

/**
 * GitHub OAuth URLs
 */
export const GITHUB_OAUTH = {
  DEVICE_CODE: 'https://github.com/login/device/code',
  ACCESS_TOKEN: 'https://github.com/login/oauth/access_token',
  AUTHORIZE: 'https://github.com/login/oauth/authorize',
} as const;

/**
 * GitHub API rate limits (authenticated requests)
 *
 * https://docs.github.com/en/rest/overview/resources-in-the-rest-api#rate-limiting
 */
export const GITHUB_RATE_LIMITS = {
  /**
   * Core API endpoints: 5,000 requests per hour
   */
  CORE: 5000,

  /**
   * Search API: 30 requests per minute
   */
  SEARCH: 30,

  /**
   * GraphQL API: 5,000 points per hour
   */
  GRAPHQL: 5000,
} as const;

/**
 * GitHub API default scopes for Forj
 */
export const GITHUB_SCOPES = {
  /**
   * Full control of repositories (read/write access)
   */
  REPO: 'repo',

  /**
   * Read organization info
   */
  READ_ORG: 'read:org',

  /**
   * Manage organization repositories
   */
  ADMIN_ORG: 'admin:org',
} as const;

/**
 * Default Forj scope configuration
 */
export const FORJ_GITHUB_SCOPES = [
  GITHUB_SCOPES.REPO,
  GITHUB_SCOPES.READ_ORG,
] as const;

/**
 * GitHub repository visibility options
 */
export const REPO_VISIBILITY = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  INTERNAL: 'internal',
} as const;

/**
 * Common .gitignore templates
 *
 * https://github.com/github/gitignore
 */
export const GITIGNORE_TEMPLATES = {
  NODE: 'Node',
  PYTHON: 'Python',
  JAVA: 'Java',
  GO: 'Go',
  RUST: 'Rust',
  RUBY: 'Ruby',
  PHP: 'PHP',
  SWIFT: 'Swift',
  KOTLIN: 'Kotlin',
} as const;

/**
 * Common license templates
 *
 * https://docs.github.com/en/rest/licenses
 */
export const LICENSE_TEMPLATES = {
  MIT: 'mit',
  APACHE_2: 'apache-2.0',
  GPL_3: 'gpl-3.0',
  BSD_3: 'bsd-3-clause',
  BSD_2: 'bsd-2-clause',
  UNLICENSE: 'unlicense',
  MPL_2: 'mpl-2.0',
  LGPL_3: 'lgpl-3.0',
  AGPL_3: 'agpl-3.0',
} as const;

/**
 * GitHub Pages source paths
 */
export const PAGES_PATHS = {
  ROOT: '/',
  DOCS: '/docs',
} as const;

/**
 * Default branch protection rules for production repositories
 */
export const DEFAULT_BRANCH_PROTECTION: {
  required_status_checks: null;
  enforce_admins: boolean;
  required_pull_request_reviews: {
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
  };
  restrictions: null;
  required_linear_history: boolean;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
} = {
  required_status_checks: null,
  enforce_admins: false,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 1,
  },
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
} as const;

/**
 * User agent for Forj requests
 */
export const FORJ_USER_AGENT = 'Forj/1.0 (https://forj.sh)';

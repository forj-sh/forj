/**
 * GitHub API error handling
 *
 * Based on GitHub REST API v3 error responses:
 * https://docs.github.com/en/rest/overview/resources-in-the-rest-api#client-errors
 */

/**
 * GitHub error categories
 */
export enum GitHubErrorCategory {
  AUTH = 'auth',                 // Authentication/authorization errors (401, 403)
  VALIDATION = 'validation',     // Validation errors (422)
  NOT_FOUND = 'not_found',      // Resource not found (404)
  RATE_LIMIT = 'rate_limit',    // Rate limiting (403 with rate limit message)
  CONFLICT = 'conflict',         // Resource conflict (409 - repo already exists)
  NETWORK = 'network',           // Network/connectivity issues
  UNKNOWN = 'unknown',           // Unrecognized errors
}

/**
 * GitHub API error response
 */
export interface GitHubErrorResponse {
  message: string;
  documentation_url?: string;
  errors?: Array<{
    resource: string;
    field: string;
    code: string;
    message?: string;
  }>;
}

/**
 * GitHub API error class
 */
export class GitHubError extends Error {
  public readonly category: GitHubErrorCategory;
  public readonly statusCode?: number;
  public readonly response?: GitHubErrorResponse;
  public readonly retryable: boolean;

  constructor(
    message: string,
    category: GitHubErrorCategory,
    statusCode?: number,
    response?: GitHubErrorResponse
  ) {
    super(message);
    this.name = 'GitHubError';
    this.category = category;
    this.statusCode = statusCode;
    this.response = response;
    this.retryable = this.isRetryable();

    // Maintain proper stack trace (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GitHubError);
    }
  }

  /**
   * Determine if error is retryable
   */
  private isRetryable(): boolean {
    switch (this.category) {
      case GitHubErrorCategory.RATE_LIMIT:
      case GitHubErrorCategory.NETWORK:
        return true;
      case GitHubErrorCategory.AUTH:
      case GitHubErrorCategory.VALIDATION:
      case GitHubErrorCategory.NOT_FOUND:
      case GitHubErrorCategory.CONFLICT:
      case GitHubErrorCategory.UNKNOWN:
        return false;
      default:
        return false;
    }
  }

  /**
   * Get user-friendly error message
   */
  public getUserMessage(): string {
    switch (this.category) {
      case GitHubErrorCategory.AUTH:
        return 'GitHub authentication failed. Please check your access token and permissions.';
      case GitHubErrorCategory.VALIDATION:
        return this.response?.message || 'Invalid request data. Please check your input.';
      case GitHubErrorCategory.NOT_FOUND:
        return this.response?.message || 'GitHub resource not found.';
      case GitHubErrorCategory.RATE_LIMIT:
        return 'GitHub API rate limit exceeded. Please try again later.';
      case GitHubErrorCategory.CONFLICT:
        return this.response?.message || 'Resource already exists.';
      case GitHubErrorCategory.NETWORK:
        return 'Network error connecting to GitHub. Please check your connection.';
      case GitHubErrorCategory.UNKNOWN:
        return 'An unexpected error occurred with GitHub API.';
      default:
        return 'An error occurred.';
    }
  }
}

/**
 * Categorize GitHub error by HTTP status code
 */
export function categorizeErrorByStatus(
  statusCode: number,
  response?: GitHubErrorResponse
): GitHubErrorCategory {
  // Check for rate limit first (403 with specific message)
  if (statusCode === 403 && response?.message?.toLowerCase().includes('rate limit')) {
    return GitHubErrorCategory.RATE_LIMIT;
  }

  // Categorize by status code
  switch (statusCode) {
    case 401:
    case 403:
      return GitHubErrorCategory.AUTH;
    case 404:
      return GitHubErrorCategory.NOT_FOUND;
    case 409:
      return GitHubErrorCategory.CONFLICT;
    case 422:
      return GitHubErrorCategory.VALIDATION;
    case 500:
    case 502:
    case 503:
    case 504:
      return GitHubErrorCategory.NETWORK;
    default:
      return GitHubErrorCategory.UNKNOWN;
  }
}

/**
 * Create GitHubError from fetch response
 */
export async function createErrorFromResponse(
  response: Response,
  operation: string
): Promise<GitHubError> {
  let responseData: GitHubErrorResponse | undefined;

  try {
    responseData = (await response.json()) as GitHubErrorResponse;
  } catch {
    // Response body is not JSON or empty
    responseData = {
      message: response.statusText || 'Unknown error',
    };
  }

  const category = categorizeErrorByStatus(response.status, responseData);
  const message = `GitHub ${operation} failed: ${responseData.message}`;

  return new GitHubError(message, category, response.status, responseData);
}

/**
 * Create GitHubError from network error
 */
export function createNetworkError(operation: string, error: Error): GitHubError {
  const message = `GitHub ${operation} failed: ${error.message}`;
  return new GitHubError(message, GitHubErrorCategory.NETWORK, undefined, {
    message: error.message,
  });
}

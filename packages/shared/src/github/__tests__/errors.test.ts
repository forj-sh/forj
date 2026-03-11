/**
 * Unit tests for GitHub error handling
 */

import { describe, it, expect } from '@jest/globals';
import {
  GitHubError,
  GitHubErrorCategory,
  categorizeErrorByStatus,
  createErrorFromResponse,
  createNetworkError,
} from '../errors.js';

describe('GitHubError', () => {
  describe('constructor', () => {
    it('should create error with all properties', () => {
      const error = new GitHubError(
        'Test error',
        GitHubErrorCategory.AUTH,
        401,
        { message: 'Unauthorized' }
      );

      expect(error.message).toBe('Test error');
      expect(error.category).toBe(GitHubErrorCategory.AUTH);
      expect(error.statusCode).toBe(401);
      expect(error.response).toEqual({ message: 'Unauthorized' });
      expect(error.name).toBe('GitHubError');
    });

    it('should set retryable based on category', () => {
      const rateLimitError = new GitHubError(
        'Rate limit',
        GitHubErrorCategory.RATE_LIMIT
      );
      const authError = new GitHubError('Auth failed', GitHubErrorCategory.AUTH);

      expect(rateLimitError.retryable).toBe(true);
      expect(authError.retryable).toBe(false);
    });
  });

  describe('retryability', () => {
    it('should mark rate limit errors as retryable', () => {
      const error = new GitHubError('Rate limit', GitHubErrorCategory.RATE_LIMIT);
      expect(error.retryable).toBe(true);
    });

    it('should mark network errors as retryable', () => {
      const error = new GitHubError('Network error', GitHubErrorCategory.NETWORK);
      expect(error.retryable).toBe(true);
    });

    it('should mark auth errors as non-retryable', () => {
      const error = new GitHubError('Auth failed', GitHubErrorCategory.AUTH);
      expect(error.retryable).toBe(false);
    });

    it('should mark validation errors as non-retryable', () => {
      const error = new GitHubError('Validation failed', GitHubErrorCategory.VALIDATION);
      expect(error.retryable).toBe(false);
    });

    it('should mark not found errors as non-retryable', () => {
      const error = new GitHubError('Not found', GitHubErrorCategory.NOT_FOUND);
      expect(error.retryable).toBe(false);
    });

    it('should mark conflict errors as non-retryable', () => {
      const error = new GitHubError('Conflict', GitHubErrorCategory.CONFLICT);
      expect(error.retryable).toBe(false);
    });
  });

  describe('getUserMessage', () => {
    it('should return friendly message for auth errors', () => {
      const error = new GitHubError('Auth failed', GitHubErrorCategory.AUTH);
      expect(error.getUserMessage()).toBe(
        'GitHub authentication failed. Please check your access token and permissions.'
      );
    });

    it('should return friendly message for validation errors', () => {
      const error = new GitHubError('Validation failed', GitHubErrorCategory.VALIDATION);
      expect(error.getUserMessage()).toBe(
        'Invalid request data. Please check your input.'
      );
    });

    it('should use response message for validation errors if available', () => {
      const error = new GitHubError(
        'Validation failed',
        GitHubErrorCategory.VALIDATION,
        422,
        { message: 'Repository name is invalid' }
      );
      expect(error.getUserMessage()).toBe('Repository name is invalid');
    });

    it('should return friendly message for not found errors', () => {
      const error = new GitHubError('Not found', GitHubErrorCategory.NOT_FOUND);
      expect(error.getUserMessage()).toBe('GitHub resource not found.');
    });

    it('should return friendly message for rate limit errors', () => {
      const error = new GitHubError('Rate limit', GitHubErrorCategory.RATE_LIMIT);
      expect(error.getUserMessage()).toBe(
        'GitHub API rate limit exceeded. Please try again later.'
      );
    });

    it('should return friendly message for conflict errors', () => {
      const error = new GitHubError('Conflict', GitHubErrorCategory.CONFLICT);
      expect(error.getUserMessage()).toBe('Resource already exists.');
    });

    it('should return friendly message for network errors', () => {
      const error = new GitHubError('Network error', GitHubErrorCategory.NETWORK);
      expect(error.getUserMessage()).toBe(
        'Network error connecting to GitHub. Please check your connection.'
      );
    });

    it('should return friendly message for unknown errors', () => {
      const error = new GitHubError('Unknown', GitHubErrorCategory.UNKNOWN);
      expect(error.getUserMessage()).toBe('An unexpected error occurred with GitHub API.');
    });
  });
});

describe('categorizeErrorByStatus', () => {
  it('should categorize 401 as AUTH', () => {
    expect(categorizeErrorByStatus(401)).toBe(GitHubErrorCategory.AUTH);
  });

  it('should categorize 403 as AUTH', () => {
    expect(categorizeErrorByStatus(403)).toBe(GitHubErrorCategory.AUTH);
  });

  it('should categorize 403 with rate limit message as RATE_LIMIT', () => {
    const response = { message: 'API rate limit exceeded' };
    expect(categorizeErrorByStatus(403, response)).toBe(GitHubErrorCategory.RATE_LIMIT);
  });

  it('should categorize 404 as NOT_FOUND', () => {
    expect(categorizeErrorByStatus(404)).toBe(GitHubErrorCategory.NOT_FOUND);
  });

  it('should categorize 409 as CONFLICT', () => {
    expect(categorizeErrorByStatus(409)).toBe(GitHubErrorCategory.CONFLICT);
  });

  it('should categorize 422 as VALIDATION', () => {
    expect(categorizeErrorByStatus(422)).toBe(GitHubErrorCategory.VALIDATION);
  });

  it('should categorize 500 as NETWORK', () => {
    expect(categorizeErrorByStatus(500)).toBe(GitHubErrorCategory.NETWORK);
  });

  it('should categorize 502 as NETWORK', () => {
    expect(categorizeErrorByStatus(502)).toBe(GitHubErrorCategory.NETWORK);
  });

  it('should categorize 503 as NETWORK', () => {
    expect(categorizeErrorByStatus(503)).toBe(GitHubErrorCategory.NETWORK);
  });

  it('should categorize 504 as NETWORK', () => {
    expect(categorizeErrorByStatus(504)).toBe(GitHubErrorCategory.NETWORK);
  });

  it('should categorize unknown status codes as UNKNOWN', () => {
    expect(categorizeErrorByStatus(418)).toBe(GitHubErrorCategory.UNKNOWN);
  });
});

describe('createErrorFromResponse', () => {
  it('should create error from JSON response', async () => {
    const response = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Bad credentials' }),
    } as unknown as Response;

    const error = await createErrorFromResponse(response, 'create repo');

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.category).toBe(GitHubErrorCategory.AUTH);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('GitHub create repo failed: Bad credentials');
    expect(error.response?.message).toBe('Bad credentials');
  });

  it('should handle non-JSON response', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('Not JSON');
      },
    } as unknown as Response;

    const error = await createErrorFromResponse(response, 'list repos');

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.category).toBe(GitHubErrorCategory.NETWORK);
    expect(error.statusCode).toBe(500);
    expect(error.response?.message).toBe('Internal Server Error');
  });

  it('should handle empty response', async () => {
    const response = {
      ok: false,
      status: 404,
      statusText: '',
      json: async () => {
        throw new Error('Empty');
      },
    } as unknown as Response;

    const error = await createErrorFromResponse(response, 'get org');

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.response?.message).toBe('Unknown error');
  });
});

describe('createNetworkError', () => {
  it('should create network error from Error', () => {
    const originalError = new Error('Connection refused');
    const error = createNetworkError('verify org', originalError);

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.category).toBe(GitHubErrorCategory.NETWORK);
    expect(error.message).toBe('GitHub verify org failed: Connection refused');
    expect(error.response?.message).toBe('Connection refused');
    expect(error.retryable).toBe(true);
  });

  it('should handle error without message', () => {
    const originalError = new Error();
    const error = createNetworkError('list repos', originalError);

    expect(error).toBeInstanceOf(GitHubError);
    expect(error.category).toBe(GitHubErrorCategory.NETWORK);
    expect(error.response?.message).toBe('');
  });
});

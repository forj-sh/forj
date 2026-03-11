/**
 * Unit tests for GitHub API client
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GitHubClient } from '../client.js';
import { GitHubError, GitHubErrorCategory } from '../errors.js';

// Mock fetch globally
global.fetch = jest.fn() as any;

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    client = new GitHubClient({ accessToken: 'gho_test_token' });
    jest.clearAllMocks();
  });

  describe('verifyOrg', () => {
    it('should verify organization exists', async () => {
      const mockOrg = {
        login: 'forj-sh',
        id: 123456,
        type: 'Organization',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockOrg,
      });

      const result = await client.verifyOrg('forj-sh');

      expect(result).toEqual(mockOrg);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/orgs/forj-sh',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer gho_test_token',
            Accept: 'application/vnd.github.v3+json',
          }),
        })
      );
    });

    it('should throw GitHubError for non-existent org', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      });

      await expect(client.verifyOrg('nonexistent')).rejects.toThrow(
        expect.objectContaining({
          category: GitHubErrorCategory.NOT_FOUND,
        })
      );
    });
  });

  describe('listRepos', () => {
    it('should list organization repositories', async () => {
      const mockRepos = [
        { id: 1, name: 'repo1', full_name: 'forj-sh/repo1' },
        { id: 2, name: 'repo2', full_name: 'forj-sh/repo2' },
      ];

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRepos,
      });

      const result = await client.listRepos('forj-sh');

      expect(result).toEqual(mockRepos);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/orgs/forj-sh/repos?type=all&per_page=100',
        expect.any(Object)
      );
    });

    it('should filter repositories by type', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await client.listRepos('forj-sh', 'private');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/orgs/forj-sh/repos?type=private&per_page=100',
        expect.any(Object)
      );
    });
  });

  describe('createRepo', () => {
    it('should create repository in organization', async () => {
      const mockRepo = {
        id: 123,
        name: 'new-repo',
        full_name: 'forj-sh/new-repo',
        private: true,
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockRepo,
      });

      const result = await client.createRepo('forj-sh', {
        name: 'new-repo',
        private: true,
        description: 'Test repository',
      });

      expect(result).toEqual(mockRepo);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/orgs/forj-sh/repos',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            name: 'new-repo',
            private: true,
            description: 'Test repository',
          }),
        })
      );
    });

    it('should throw GitHubError for duplicate repository', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          message: 'Repository creation failed',
          errors: [{ field: 'name', code: 'already_exists' }],
        }),
      });

      await expect(
        client.createRepo('forj-sh', { name: 'existing-repo' })
      ).rejects.toThrow(GitHubError);
    });
  });

  describe('getRepo', () => {
    it('should get repository details', async () => {
      const mockRepo = {
        id: 123,
        name: 'test-repo',
        full_name: 'forj-sh/test-repo',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRepo,
      });

      const result = await client.getRepo('forj-sh', 'test-repo');

      expect(result).toEqual(mockRepo);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/forj-sh/test-repo',
        expect.any(Object)
      );
    });
  });

  describe('setBranchProtection', () => {
    it('should set branch protection rules', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await client.setBranchProtection('forj-sh', 'test-repo', 'main', {
        required_pull_request_reviews: {
          required_approving_review_count: 1,
        },
        enforce_admins: false,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/forj-sh/test-repo/branches/main/protection',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('required_approving_review_count'),
        })
      );
    });
  });

  describe('createFile', () => {
    it('should create file in repository', async () => {
      const mockResponse = {
        commit: { sha: 'abc123' },
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      });

      const result = await client.createFile('forj-sh', 'test-repo', {
        path: 'README.md',
        content: '# Test Repository',
        message: 'Add README',
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/forj-sh/test-repo/contents/README.md',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining(Buffer.from('# Test Repository').toString('base64')),
        })
      );
    });

    it('should use default commit message if not provided', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ commit: { sha: 'abc123' } }),
      });

      await client.createFile('forj-sh', 'test-repo', {
        path: 'src/index.ts',
        content: 'console.log("hello");',
      });

      const call = (global.fetch as jest.Mock).mock.calls[0];
      const callBody = JSON.parse((call[1] as any).body as string);
      expect(callBody.message).toBe('Add src/index.ts');
    });
  });

  describe('configurePages', () => {
    it('should enable GitHub Pages', async () => {
      const mockResponse = {
        html_url: 'https://forj-sh.github.io/test-repo',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockResponse,
      });

      const result = await client.configurePages('forj-sh', 'test-repo', {
        source: {
          branch: 'main',
          path: '/',
        },
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/forj-sh/test-repo/pages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/vnd.github.switcheroo-preview+json',
          }),
        })
      );
    });
  });

  describe('getPagesStatus', () => {
    it('should get GitHub Pages status', async () => {
      const mockResponse = {
        status: 'built',
        html_url: 'https://forj-sh.github.io/test-repo',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPagesStatus('forj-sh', 'test-repo');

      expect(result).toEqual(mockResponse);
    });
  });

  describe('createFiles', () => {
    it('should create multiple files sequentially', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ commit: { sha: 'sha1' } }),
      });

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ commit: { sha: 'sha2' } }),
      });

      const result = await client.createFiles('forj-sh', 'test-repo', [
        { path: 'file1.txt', content: 'content1' },
        { path: 'file2.txt', content: 'content2' },
      ]);

      expect(result).toEqual(['sha1', 'sha2']);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAuthenticatedUser', () => {
    it('should get authenticated user information', async () => {
      const mockUser = {
        login: 'testuser',
        id: 12345,
        email: 'test@example.com',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUser,
      });

      const result = await client.getAuthenticatedUser();

      expect(result).toEqual(mockUser);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.any(Object)
      );
    });
  });

  describe('getRepoTopics', () => {
    it('should get repository topics', async () => {
      const mockResponse = {
        names: ['typescript', 'nodejs', 'cli'],
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getRepoTopics('forj-sh', 'test-repo');

      expect(result).toEqual(mockResponse);
    });
  });

  describe('setRepoTopics', () => {
    it('should set repository topics', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ names: ['typescript', 'nodejs'] }),
      });

      await client.setRepoTopics('forj-sh', 'test-repo', ['typescript', 'nodejs']);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/forj-sh/test-repo/topics',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ names: ['typescript', 'nodejs'] }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(client.verifyOrg('forj-sh')).rejects.toThrow(
        expect.objectContaining({
          category: GitHubErrorCategory.NETWORK,
        })
      );
    });

    it('should handle rate limit errors', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          message: 'API rate limit exceeded',
        }),
      });

      await expect(client.listRepos('forj-sh')).rejects.toThrow(
        expect.objectContaining({
          category: GitHubErrorCategory.RATE_LIMIT,
        })
      );
    });

    it('should handle 204 No Content responses', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: jest.fn(),
      });

      const result = await client.setBranchProtection('forj-sh', 'test-repo', 'main', {
        enforce_admins: false,
      });

      expect(result).toBeUndefined();
    });
  });
});

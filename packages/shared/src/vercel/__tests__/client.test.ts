/**
 * Unit tests for Vercel client
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { VercelClient } from '../client.js';
import { VercelApiError, VercelErrorCategory } from '../errors.js';
import type { VercelConfig, VercelUser, VercelProject, VercelDomain } from '../types.js';

// Mock fetch globally
global.fetch = jest.fn() as any;

function createMockUser(partial?: Partial<VercelUser>): VercelUser {
  return {
    id: 'user123',
    email: 'test@example.com',
    name: 'Test User',
    username: 'testuser',
    avatar: null,
    defaultTeamId: null,
    ...partial,
  };
}

function createMockProject(partial?: Partial<VercelProject>): VercelProject {
  return {
    id: 'prj_abc123',
    name: 'my-project',
    accountId: 'team_xyz',
    framework: null,
    devCommand: null,
    installCommand: null,
    buildCommand: null,
    outputDirectory: null,
    rootDirectory: null,
    nodeVersion: '18.x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
}

describe('VercelClient', () => {
  const mockConfig: VercelConfig = {
    token: 'test_vercel_token',
    teamId: 'team_xyz',
  };

  let client: VercelClient;

  beforeEach(() => {
    client = new VercelClient(mockConfig);
    (global.fetch as any).mockReset();
  });

  describe('getUser', () => {
    it('returns the authenticated user', async () => {
      const mockUser = createMockUser();
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: mockUser }),
      });

      const user = await client.getUser();
      expect(user.username).toBe('testuser');
      expect(user.email).toBe('test@example.com');
    });

    it('appends teamId to request URL', async () => {
      const mockUser = createMockUser();
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: mockUser }),
      });

      await client.getUser();

      const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
      expect(calledUrl).toContain('teamId=team_xyz');
    });

    it('throws VercelApiError on 401', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: async () => ({ error: { code: 'forbidden', message: 'Invalid token' } }),
      });

      await expect(client.getUser()).rejects.toThrow(VercelApiError);
      try {
        await client.getUser();
      } catch (err) {
        // Reset mock first since getUser was already called
      }
    });
  });

  describe('createProject', () => {
    it('creates a project with GitHub link', async () => {
      const mockProject = createMockProject({ name: 'newco1' });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProject,
      });

      const project = await client.createProject({
        name: 'newco1',
        gitRepository: { type: 'github', repo: 'newco1/newco1' },
      });

      expect(project.name).toBe('newco1');

      const [, options] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.gitRepository.type).toBe('github');
      expect(body.gitRepository.repo).toBe('newco1/newco1');
    });
  });

  describe('addDomain', () => {
    it('adds a custom domain to a project', async () => {
      const mockDomain: VercelDomain = {
        name: 'newco1.xyz',
        apexName: 'newco1.xyz',
        projectId: 'prj_abc123',
        verified: false,
        verification: [
          { type: 'TXT', domain: '_vercel.newco1.xyz', value: 'vc-abc123', reason: 'pending' },
        ],
        gitBranch: null,
        redirect: null,
        redirectStatusCode: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDomain,
      });

      const domain = await client.addDomain('prj_abc123', 'newco1.xyz');
      expect(domain.name).toBe('newco1.xyz');
      expect(domain.verified).toBe(false);
    });
  });

  describe('retry on 429', () => {
    it('retries on rate limit with backoff', async () => {
      const mockUser = createMockUser();

      // First call returns 429, second succeeds
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'Retry-After': '1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ user: mockUser }),
        });

      const user = await client.getUser();
      expect(user.username).toBe('testuser');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('error handling', () => {
    it('throws CONFLICT for 409', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers(),
        json: async () => ({ error: { code: 'conflict', message: 'Project already exists' } }),
      });

      try {
        await client.createProject({ name: 'existing' });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VercelApiError);
        expect((err as VercelApiError).category).toBe(VercelErrorCategory.CONFLICT);
        expect((err as VercelApiError).isRetryable()).toBe(false);
      }
    });
  });
});

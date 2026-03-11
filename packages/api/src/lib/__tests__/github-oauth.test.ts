/**
 * Unit tests for GitHub OAuth Device Flow
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GitHubDeviceFlow } from '../github-oauth.js';

// Mock fetch globally
global.fetch = jest.fn() as any;

describe('GitHubDeviceFlow', () => {
  let client: GitHubDeviceFlow;

  beforeEach(() => {
    client = new GitHubDeviceFlow('test_client_id', 'test_client_secret');
    jest.clearAllMocks();
  });

  describe('initiateDeviceFlow', () => {
    it('should initiate device flow successfully', async () => {
      const mockResponse = {
        device_code: 'device123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.initiateDeviceFlow('repo read:org');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://github.com/login/device/code',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );
    });

    it('should use default scope if not provided', async () => {
      const mockResponse = {
        device_code: 'device123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.initiateDeviceFlow();

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = (fetchCall[1] as any).body;
      const params = new URLSearchParams(body);
      expect(params.get('scope')).toEqual('repo read:org');
    });

    it('should throw error on HTTP failure', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      });

      await expect(client.initiateDeviceFlow()).rejects.toThrow(
        'GitHub device flow initiation failed'
      );
    });

    it('should throw error on invalid response', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(client.initiateDeviceFlow()).rejects.toThrow(
        'Invalid response from GitHub'
      );
    });
  });

  describe('pollForToken', () => {
    it('should return pending status', async () => {
      const mockError = {
        error: 'authorization_pending',
        error_description: 'Waiting for user authorization',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockError,
      });

      const result = await client.pollForToken('device123');

      expect(result).toEqual({ status: 'pending' });
    });

    it('should return slow_down status', async () => {
      const mockError = {
        error: 'slow_down',
        error_description: 'Polling too frequently',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockError,
      });

      const result = await client.pollForToken('device123');

      expect(result).toEqual({ status: 'slow_down' });
    });

    it('should return expired status', async () => {
      const mockError = {
        error: 'expired_token',
        error_description: 'Device code has expired',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockError,
      });

      const result = await client.pollForToken('device123');

      expect(result).toEqual({ status: 'expired' });
    });

    it('should return denied status', async () => {
      const mockError = {
        error: 'access_denied',
        error_description: 'User denied authorization',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockError,
      });

      const result = await client.pollForToken('device123');

      expect(result).toEqual({ status: 'denied' });
    });

    it('should return authorized with access token', async () => {
      const mockSuccess = {
        access_token: 'gho_123456789',
        token_type: 'bearer',
        scope: 'repo read:org',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccess,
      });

      const result = await client.pollForToken('device123');

      expect(result).toEqual({
        status: 'authorized',
        accessToken: 'gho_123456789',
        scope: 'repo read:org',
      });
    });

    it('should throw error on HTTP failure', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error',
      });

      await expect(client.pollForToken('device123')).rejects.toThrow(
        'GitHub token poll failed'
      );
    });

    it('should throw error on unknown error code', async () => {
      const mockError = {
        error: 'unknown_error',
        error_description: 'Something went wrong',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockError,
      });

      await expect(client.pollForToken('device123')).rejects.toThrow(
        'Unknown GitHub OAuth error'
      );
    });
  });

  describe('getUserInfo', () => {
    it('should get user information', async () => {
      const mockUser = {
        login: 'testuser',
        id: 123456,
        email: 'test@example.com',
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const result = await client.getUserInfo('gho_123456789');

      expect(result).toEqual({
        login: 'testuser',
        id: 123456,
        email: 'test@example.com',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer gho_123456789',
          }),
        })
      );
    });

    it('should handle null email', async () => {
      const mockUser = {
        login: 'testuser',
        id: 123456,
        email: null,
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const result = await client.getUserInfo('gho_123456789');

      expect(result.email).toBeNull();
    });

    it('should throw error on HTTP failure', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(client.getUserInfo('invalid_token')).rejects.toThrow(
        'Failed to get GitHub user info'
      );
    });
  });
});

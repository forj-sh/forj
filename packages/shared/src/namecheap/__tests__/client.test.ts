/**
 * Unit tests for Namecheap client
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NamecheapClient } from '../client.js';
import type { NamecheapConfig } from '../types.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('NamecheapClient', () => {
  const mockConfig: NamecheapConfig = {
    apiUser: 'test_user',
    apiKey: 'test_key',
    userName: 'test_user',
    clientIp: '192.0.2.1',
    sandbox: true,
  };

  let client: NamecheapClient;

  beforeEach(() => {
    client = new NamecheapClient(mockConfig);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with sandbox URL', () => {
      expect(client.isSandbox()).toBe(true);
    });

    it('should create client with production URL', () => {
      const prodClient = new NamecheapClient({ ...mockConfig, sandbox: false });
      expect(prodClient.isSandbox()).toBe(false);
    });
  });

  describe('buildUrl', () => {
    it('should build URL with global and command-specific parameters', () => {
      // Access private method directly via type cast for testing
      const url = (client as any).buildUrl('namecheap.domains.check', {
        DomainList: 'example.com',
      });

      const parsed = new URL(url);
      const params = parsed.searchParams;

      // Global parameters
      expect(params.get('ApiUser')).toBe('test_user');
      expect(params.get('ApiKey')).toBe('test_key');
      expect(params.get('UserName')).toBe('test_user');
      expect(params.get('ClientIp')).toBe('192.0.2.1');

      // Command-specific parameters
      expect(params.get('Command')).toBe('namecheap.domains.check');
      expect(params.get('DomainList')).toBe('example.com');
    });
  });

  describe('executeRequest', () => {
    it('should execute successful request', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.check</RequestedCommand>
          <CommandResponse>
            <DomainCheckResult Domain="example.com" Available="true"/>
          </CommandResponse>
          <ExecutionTime>1.5</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const response = await (client as any).executeRequest('namecheap.domains.check', {
        DomainList: 'example.com',
      });

      expect(response.status).toBe('OK');
      expect(response.command).toBe('namecheap.domains.check');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Verify URL contains global parameters
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('ApiUser=test_user');
      expect(fetchCall).toContain('ApiKey=test_key');
      expect(fetchCall).toContain('UserName=test_user');
      expect(fetchCall).toContain('ClientIp=192.0.2.1');
      expect(fetchCall).toContain('Command=namecheap.domains.check');
      expect(fetchCall).toContain('DomainList=example.com');
    });

    it('should throw error on HTTP error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        (client as any).executeRequest('namecheap.domains.check')
      ).rejects.toThrow('HTTP 500');
    });

    it('should throw error on network timeout', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          const error: any = new Error('Request timeout');
          error.name = 'AbortError';
          reject(error);
        });
      });

      await expect(
        (client as any).executeRequest('namecheap.domains.check')
      ).rejects.toThrow('Request timeout');
    });

    it('should handle XML parsing errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => 'invalid xml',
      });

      await expect(
        (client as any).executeRequest('namecheap.domains.check')
      ).rejects.toThrow();
    });
  });

  describe('getConfig', () => {
    it('should return config copy with redacted apiKey', () => {
      const config = client.getConfig();

      // Check non-sensitive fields
      expect(config.apiUser).toBe('test_user');
      expect(config.userName).toBe('test_user');
      expect(config.clientIp).toBe('192.0.2.1');
      expect(config.sandbox).toBe(true);

      // Verify apiKey is redacted for security
      expect(config.apiKey).toBe('[REDACTED]');
    });
  });

  describe('isSandbox', () => {
    it('should return true for sandbox mode', () => {
      expect(client.isSandbox()).toBe(true);
    });

    it('should return false for production mode', () => {
      const prodClient = new NamecheapClient({ ...mockConfig, sandbox: false });
      expect(prodClient.isSandbox()).toBe(false);
    });
  });
});

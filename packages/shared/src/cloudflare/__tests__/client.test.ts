/**
 * Unit tests for Cloudflare client
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CloudflareClient } from '../client.js';
import { CloudflareApiError, CloudflareErrorCategory } from '../errors.js';
import type { CloudflareConfig, CloudflareZone, DNSRecord } from '../types.js';

// Mock fetch globally
global.fetch = jest.fn() as any;

/**
 * Helper functions to create complete mock objects
 */
function createMockZone(partial?: Partial<CloudflareZone>): CloudflareZone {
  return {
    id: 'zone123',
    name: 'example.com',
    status: 'active',
    paused: false,
    type: 'full',
    development_mode: 0,
    name_servers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
    original_name_servers: ['ns1.original.com', 'ns2.original.com'],
    original_registrar: 'Example Registrar',
    original_dnshost: 'Example DNS Host',
    created_on: '2024-01-01T00:00:00Z',
    modified_on: '2024-01-01T00:00:00Z',
    activated_on: '2024-01-01T00:00:00Z',
    account: {
      id: 'test_account_id',
      name: 'Test Account',
    },
    owner: {
      id: 'owner123',
      type: 'user',
      email: 'owner@example.com',
    },
    permissions: ['#zone:read', '#zone:edit'],
    plan: {
      id: 'plan123',
      name: 'Free',
      price: 0,
      currency: 'USD',
      frequency: 'monthly',
      is_subscribed: true,
      can_subscribe: false,
    },
    ...partial,
  };
}

function createMockDNSRecord(partial?: Partial<DNSRecord>): DNSRecord {
  return {
    id: 'rec123',
    zone_id: 'zone123',
    zone_name: 'example.com',
    name: 'example.com',
    type: 'A',
    content: '192.0.2.1',
    proxiable: true,
    proxied: false,
    ttl: 1,
    locked: false,
    created_on: '2024-01-01T00:00:00Z',
    modified_on: '2024-01-01T00:00:00Z',
    ...partial,
  };
}

describe('CloudflareClient', () => {
  const mockConfig: CloudflareConfig = {
    apiToken: 'test_token_1234567890',
    accountId: 'test_account_id',
  };

  let client: CloudflareClient;

  beforeEach(() => {
    client = new CloudflareClient(mockConfig);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with config', () => {
      expect(client).toBeInstanceOf(CloudflareClient);
    });

    it('should create client without account ID', () => {
      const clientWithoutAccount = new CloudflareClient({
        apiToken: 'test_token',
      });
      expect(clientWithoutAccount).toBeInstanceOf(CloudflareClient);
    });
  });

  describe('executeRequest', () => {
    it('should execute successful request', async () => {
      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
        result: { id: 'test123' },
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const response = await (client as any).executeRequest('/test', {
        method: 'GET',
      });

      expect(response.success).toBe(true);
      expect(response.result).toEqual({ id: 'test123' });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Verify authorization header (headers is now a Headers instance)
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const headers = (fetchCall[1] as any).headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer test_token_1234567890');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('User-Agent')).toBe('Forj/1.0 (https://forj.sh)');
    });

    it('should throw CloudflareApiError on API error', async () => {
      const mockErrorResponse = {
        success: false,
        errors: [
          { code: 1001, message: 'Invalid API token' },
        ],
        messages: [],
        result: null,
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse,
      });

      await expect(
        (client as any).executeRequest('/test', { method: 'GET' })
      ).rejects.toThrow(CloudflareApiError);
    });

    it('should throw CloudflareApiError on network timeout', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          const error: any = new Error('Request timeout');
          error.name = 'AbortError';
          reject(error);
        });
      });

      // Verify it throws CloudflareApiError with NETWORK category
      try {
        await (client as any).executeRequest('/test', { method: 'GET' });
        fail('Expected CloudflareApiError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CloudflareApiError);
        expect((error as CloudflareApiError).category).toBe(CloudflareErrorCategory.NETWORK);
        expect((error as CloudflareApiError).isRetryable()).toBe(true);
      }
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', async () => {
      const mockVerification = {
        success: true,
        errors: [],
        messages: [],
        result: {
          id: 'token123',
          status: 'active' as const,
          policies: [],
        },
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockVerification,
      });

      const result = await client.verifyToken();

      expect(result.id).toBe('token123');
      expect(result.status).toBe('active');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/user/tokens/verify'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('listZones', () => {
    it('should list all zones', async () => {
      const mockZones: CloudflareZone[] = [
        createMockZone({
          id: 'zone1',
          name: 'example.com',
        }),
      ];

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockZones,
        }),
      });

      const zones = await client.listZones();

      expect(zones).toHaveLength(1);
      expect(zones[0].name).toBe('example.com');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones'),
        expect.any(Object)
      );
    });

    it('should filter zones by account ID', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      await client.listZones('test_account');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect((fetchCall[0] as any)).toContain('account.id=test_account');
    });
  });

  describe('getZoneDetails', () => {
    it('should get zone details by ID', async () => {
      const mockZone = createMockZone({
        id: 'zone123',
        name: 'example.com',
      });

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockZone,
        }),
      });

      const zone = await client.getZoneDetails('zone123');

      expect(zone.id).toBe('zone123');
      expect(zone.name).toBe('example.com');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones/zone123'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('createZone', () => {
    it('should create a new zone', async () => {
      const mockZone = createMockZone({
        id: 'new_zone123',
        name: 'newdomain.com',
        status: 'pending',
      });

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockZone,
        }),
      });

      const zone = await client.createZone({
        name: 'newdomain.com',
        account: { id: 'test_account' },
      });

      expect(zone.name).toBe('newdomain.com');
      expect(zone.status).toBe('pending');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('newdomain.com'),
        })
      );
    });
  });

  describe('deleteZone', () => {
    it('should delete a zone', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: { id: 'zone123' },
        }),
      });

      const result = await client.deleteZone('zone123');

      expect(result.id).toBe('zone123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones/zone123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('listDNSRecords', () => {
    it('should list all DNS records for a zone', async () => {
      const mockRecords: DNSRecord[] = [
        createMockDNSRecord({
          id: 'rec1',
          type: 'A',
          content: '192.0.2.1',
        }),
      ];

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockRecords,
        }),
      });

      const records = await client.listDNSRecords('zone123');

      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('A');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones/zone123/dns_records'),
        expect.any(Object)
      );
    });

    it('should filter records by type', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: [],
        }),
      });

      await client.listDNSRecords('zone123', 'MX');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect((fetchCall[0] as any)).toContain('type=MX');
    });
  });

  describe('createDNSRecord', () => {
    it('should create a DNS record', async () => {
      const mockRecord = createMockDNSRecord({
        id: 'rec123',
        type: 'A',
        name: 'www.example.com',
        content: '192.0.2.1',
        ttl: 1,
      });

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockRecord,
        }),
      });

      const record = await client.createDNSRecord('zone123', {
        type: 'A',
        name: 'www',
        content: '192.0.2.1',
      });

      expect(record.type).toBe('A');
      expect(record.content).toBe('192.0.2.1');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones/zone123/dns_records'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('192.0.2.1'),
        })
      );
    });
  });

  describe('updateDNSRecord', () => {
    it('should update a DNS record', async () => {
      const mockRecord = createMockDNSRecord({
        id: 'rec123',
        name: 'www.example.com',
        content: '192.0.2.2',
      });

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockRecord,
        }),
      });

      const record = await client.updateDNSRecord('zone123', 'rec123', {
        content: '192.0.2.2',
      });

      expect(record.content).toBe('192.0.2.2');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones/zone123/dns_records/rec123'),
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
  });

  describe('deleteDNSRecord', () => {
    it('should delete a DNS record', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: { id: 'rec123' },
        }),
      });

      const result = await client.deleteDNSRecord('zone123', 'rec123');

      expect(result.id).toBe('rec123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/zones/zone123/dns_records/rec123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('getAccount', () => {
    it('should get account details with provided ID', async () => {
      const mockAccount = {
        id: 'acc123',
        name: 'Test Account',
        type: 'standard' as const,
      };

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockAccount,
        }),
      });

      const account = await client.getAccount('acc123');

      expect(account.id).toBe('acc123');
      expect(account.name).toBe('Test Account');
    });

    it('should use config accountId if not provided', async () => {
      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: { id: 'test_account_id' },
        }),
      });

      await client.getAccount();

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect((fetchCall[0] as any)).toContain('/accounts/test_account_id');
    });

    it('should throw error if no account ID available', async () => {
      const clientNoAccount = new CloudflareClient({ apiToken: 'test' });

      await expect(clientNoAccount.getAccount()).rejects.toThrow('Account ID required');
    });
  });

  describe('listAccounts', () => {
    it('should list all accounts', async () => {
      const mockAccounts = [
        { id: 'acc1', name: 'Account 1', type: 'standard' as const },
        { id: 'acc2', name: 'Account 2', type: 'enterprise' as const },
      ];

      // @ts-expect-error - Mock typing
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          messages: [],
          result: mockAccounts,
        }),
      });

      const accounts = await client.listAccounts();

      expect(accounts).toHaveLength(2);
      expect(accounts[0].name).toBe('Account 1');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/accounts'),
        expect.any(Object)
      );
    });
  });
});

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

  describe('checkDomains', () => {
    it('should throw error for empty domain list', async () => {
      await expect(client.checkDomains([])).rejects.toThrow('At least one domain is required');
    });

    it('should throw error for more than 50 domains', async () => {
      const domains = Array.from({ length: 51 }, (_, i) => `domain${i}.com`);
      await expect(client.checkDomains(domains)).rejects.toThrow('Maximum 50 domains per check');
    });

    it('should check single domain availability', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.check</RequestedCommand>
          <CommandResponse>
            <DomainCheckResult Domain="example.com" Available="true" IsPremiumName="false"
              PremiumRegistrationPrice="0" PremiumRenewalPrice="0" IcannFee="0.18"
              ErrorNo="0" Description=""/>
          </CommandResponse>
          <ExecutionTime>0.5</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const results = await client.checkDomains(['example.com']);

      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe('example.com');
      expect(results[0].available).toBe(true);
      expect(results[0].isPremium).toBe(false);
      expect(results[0].icannFee).toBe(0.18);
    });

    it('should check multiple domains with premium pricing', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.check</RequestedCommand>
          <CommandResponse>
            <DomainCheckResult Domain="example.com" Available="true" IsPremiumName="false"
              PremiumRegistrationPrice="0" PremiumRenewalPrice="0" IcannFee="0.18"
              ErrorNo="0" Description=""/>
            <DomainCheckResult Domain="premium.com" Available="true" IsPremiumName="true"
              PremiumRegistrationPrice="2500.00" PremiumRenewalPrice="2500.00" IcannFee="0.18"
              ErrorNo="0" Description="Premium domain"/>
          </CommandResponse>
          <ExecutionTime>0.8</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const results = await client.checkDomains(['example.com', 'premium.com']);

      expect(results).toHaveLength(2);
      expect(results[0].domain).toBe('example.com');
      expect(results[0].isPremium).toBe(false);
      expect(results[1].domain).toBe('premium.com');
      expect(results[1].isPremium).toBe(true);
      expect(results[1].premiumRegistrationPrice).toBe(2500.00);
    });
  });

  describe('getTldPricing', () => {
    it('should fetch all TLD pricing', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.users.getPricing</RequestedCommand>
          <CommandResponse>
            <UserGetPricingResult>
              <ProductType Name="DOMAINS">
                <ProductCategory Name="domains">
                  <Product Name="COM">
                    <Price Duration="1" DurationType="YEAR" Price="8.88" RegularPrice="12.98"
                      AdditionalCost="0.18" Currency="USD" ActionName="REGISTER"/>
                    <Price Duration="1" DurationType="YEAR" Price="9.88" RegularPrice="13.98"
                      AdditionalCost="0.18" Currency="USD" ActionName="RENEW"/>
                  </Product>
                </ProductCategory>
              </ProductType>
            </UserGetPricingResult>
          </CommandResponse>
          <ExecutionTime>1.2</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const results = await client.getTldPricing();

      expect(results).toHaveLength(2);
      expect(results[0].tld).toBe('COM');
      expect(results[0].action).toBe('REGISTER');
      expect(results[0].duration).toBe(1);
      expect(results[0].wholesalePrice).toBe(8.88);
      expect(results[0].retailPrice).toBe(12.98);
      expect(results[0].icannFee).toBe(0.18);
      expect(results[1].action).toBe('RENEW');
    });

    it('should filter by TLD', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.users.getPricing</RequestedCommand>
          <CommandResponse>
            <UserGetPricingResult>
              <ProductType Name="DOMAINS">
                <ProductCategory Name="domains">
                  <Product Name="IO">
                    <Price Duration="1" DurationType="YEAR" Price="32.88" RegularPrice="39.98"
                      AdditionalCost="0.00" Currency="USD" ActionName="REGISTER"/>
                  </Product>
                </ProductCategory>
              </ProductType>
            </UserGetPricingResult>
          </CommandResponse>
          <ExecutionTime>0.9</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const results = await client.getTldPricing('io', 'REGISTER');

      expect(results).toHaveLength(1);
      expect(results[0].tld).toBe('IO');
      expect(results[0].action).toBe('REGISTER');
      expect(results[0].wholesalePrice).toBe(32.88);
    });
  });

  describe('createDomain', () => {
    const mockContactInfo = {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'San Francisco',
      stateProvince: 'CA',
      postalCode: '94102',
      country: 'US',
      phone: '+1.4155551234',
      emailAddress: 'john@example.com',
    };

    it('should throw error when isPremiumDomain is true but premiumPrice is not provided', async () => {
      await expect(
        client.createDomain({
          domainName: 'premium.com',
          years: 1,
          registrant: mockContactInfo,
          tech: mockContactInfo,
          admin: mockContactInfo,
          auxBilling: mockContactInfo,
          addFreeWhoisguard: false,
          wgEnabled: false,
          isPremiumDomain: true,
          // premiumPrice missing
        })
      ).rejects.toThrow('premiumPrice is required when isPremiumDomain is true');
    });

    it('should register a standard domain', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.create</RequestedCommand>
          <CommandResponse>
            <DomainCreateResult Domain="example.com" Registered="true" ChargedAmount="12.98"
              DomainID="12345" OrderID="67890" TransactionID="54321"
              WhoisguardEnable="false" NonRealTimeDomain="false"/>
          </CommandResponse>
          <ExecutionTime>2.5</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const result = await client.createDomain({
        domainName: 'example.com',
        years: 1,
        registrant: mockContactInfo,
        tech: mockContactInfo,
        admin: mockContactInfo,
        auxBilling: mockContactInfo,
        addFreeWhoisguard: false,
        wgEnabled: false,
      });

      expect(result.domain).toBe('example.com');
      expect(result.registered).toBe(true);
      expect(result.chargedAmount).toBe(12.98);
      expect(result.domainId).toBe(12345);
      expect(result.orderId).toBe(67890);
      expect(result.transactionId).toBe(54321);
      expect(result.whoisguardEnabled).toBe(false);
      expect(result.nonRealTimeDomain).toBe(false);
    });

    it('should register a premium domain with price', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.create</RequestedCommand>
          <CommandResponse>
            <DomainCreateResult Domain="premium.com" Registered="true" ChargedAmount="2500.00"
              DomainID="12346" OrderID="67891" TransactionID="54322"
              WhoisguardEnable="true" NonRealTimeDomain="false"/>
          </CommandResponse>
          <ExecutionTime>3.0</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const result = await client.createDomain({
        domainName: 'premium.com',
        years: 1,
        registrant: mockContactInfo,
        tech: mockContactInfo,
        admin: mockContactInfo,
        auxBilling: mockContactInfo,
        addFreeWhoisguard: true,
        wgEnabled: true,
        isPremiumDomain: true,
        premiumPrice: 2500.0,
      });

      expect(result.domain).toBe('premium.com');
      expect(result.registered).toBe(true);
      expect(result.chargedAmount).toBe(2500.0);
      expect(result.whoisguardEnabled).toBe(true);

      // Verify premium params were sent
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('IsPremiumDomain=true');
      expect(fetchCall).toContain('PremiumPrice=2500');
    });

    it('should register domain with custom nameservers', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.create</RequestedCommand>
          <CommandResponse>
            <DomainCreateResult Domain="example.com" Registered="true" ChargedAmount="12.98"
              DomainID="12345" OrderID="67890" TransactionID="54321"
              WhoisguardEnable="false" NonRealTimeDomain="false"/>
          </CommandResponse>
          <ExecutionTime>2.5</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      await client.createDomain({
        domainName: 'example.com',
        years: 1,
        registrant: mockContactInfo,
        tech: mockContactInfo,
        admin: mockContactInfo,
        auxBilling: mockContactInfo,
        addFreeWhoisguard: false,
        wgEnabled: false,
        nameservers: ['ns1.example.com', 'ns2.example.com'],
      });

      // Verify nameservers were sent
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('Nameservers=ns1.example.com%2Cns2.example.com');
    });
  });

  describe('setCustomNameservers', () => {
    it('should throw error for empty nameserver list', async () => {
      await expect(client.setCustomNameservers('example', 'com', [])).rejects.toThrow(
        'At least one nameserver is required'
      );
    });

    it('should set custom nameservers successfully', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.dns.setCustom</RequestedCommand>
          <CommandResponse>
            <DomainDNSSetCustomResult Domain="example.com" Updated="true"/>
          </CommandResponse>
          <ExecutionTime>0.8</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const result = await client.setCustomNameservers('example', 'com', [
        'ns1.example.com',
        'ns2.example.com',
      ]);

      expect(result).toBe(true);

      // Verify parameters were sent correctly
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('SLD=example');
      expect(fetchCall).toContain('TLD=com');
      expect(fetchCall).toContain('Nameservers=ns1.example.com%2Cns2.example.com');
    });

    it('should handle update failure', async () => {
      const mockXml = `
        <ApiResponse Status="OK">
          <Errors/>
          <RequestedCommand>namecheap.domains.dns.setCustom</RequestedCommand>
          <CommandResponse>
            <DomainDNSSetCustomResult Domain="example.com" Updated="false"/>
          </CommandResponse>
          <ExecutionTime>0.5</ExecutionTime>
        </ApiResponse>
      `;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => mockXml,
      });

      const result = await client.setCustomNameservers('example', 'com', ['ns1.example.com']);

      expect(result).toBe(false);
    });
  });
});

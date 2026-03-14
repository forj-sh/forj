/**
 * DNS health checker service
 *
 * Verifies DNS records are properly configured and propagated.
 * Provides auto-repair functionality for common DNS configuration issues.
 */

import { promises as dns } from 'dns';
import type {
  DNSHealthResult,
  DNSHealthStatus,
  DNSRecord,
  DNSRecordStatus,
  DNSRecordType,
  DNSFixResponse,
} from '@forj/shared';
import {
  CloudflareClient,
  type CloudflareDNSRecord,
  EmailProvider,
  DEFAULT_MX_RECORDS,
  DEFAULT_SPF_RECORDS,
  DEFAULT_DMARC_RECORD,
} from '@forj/shared';

/**
 * Expected DNS configuration for a project
 */
export interface ExpectedDNSConfig {
  domain: string;
  zoneId: string;
  emailProvider?: EmailProvider;
  customMXRecords?: Array<{ priority: number; value: string }>;
  customSPF?: string;
  githubOrg?: string;
  vercelDomain?: string;
  customCNAMEs?: Array<{ name: string; value: string }>;
}

/**
 * DNS health check options
 */
export interface DNSHealthCheckOptions {
  /**
   * DNS nameservers to use for queries (defaults to system resolver)
   */
  nameservers?: string[];
}

/**
 * DNS health checker
 */
export class DNSHealthChecker {
  private resolver: dns.Resolver;

  constructor(options: DNSHealthCheckOptions = {}) {
    this.resolver = new dns.Resolver();

    if (options.nameservers && options.nameservers.length > 0) {
      this.resolver.setServers(options.nameservers);
    }
  }

  /**
   * Check DNS health for a project
   */
  async checkHealth(config: ExpectedDNSConfig): Promise<DNSHealthResult> {
    const records: DNSRecord[] = [];

    // Build expected records from configuration
    const expectedRecords = this.buildExpectedRecords(config);

    // Check each expected record
    for (const expected of expectedRecords) {
      try {
        const actual = await this.queryRecord(expected.type, expected.name);
        const status = this.compareRecords(expected, actual);

        records.push({
          type: expected.type,
          name: expected.name,
          value: expected.value,
          status: status.valid ? 'valid' : 'invalid',
          error: status.error,
        });
      } catch (error) {
        records.push({
          type: expected.type,
          name: expected.name,
          value: expected.value,
          status: 'missing',
          error: (error as Error).message,
        });
      }
    }

    // Determine overall health status
    const overall = this.calculateOverallHealth(records);

    return {
      domain: config.domain,
      overall,
      records,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Auto-repair DNS issues by recreating missing/invalid records
   */
  async autoRepair(
    config: ExpectedDNSConfig,
    cloudflareApiToken: string,
    recordTypes?: DNSRecordType[]
  ): Promise<DNSFixResponse> {
    const client = new CloudflareClient({ apiToken: cloudflareApiToken });
    const fixed: string[] = [];
    const failed: string[] = [];

    // Get current health status
    const health = await this.checkHealth(config);

    // Filter records to fix
    const recordsToFix = health.records.filter(
      (record) =>
        (record.status === 'invalid' || record.status === 'missing') &&
        (!recordTypes || recordTypes.includes(record.type))
    );

    if (recordsToFix.length === 0) {
      return { fixed, failed };
    }

    // Get all existing DNS records from Cloudflare
    const existingRecords = await client.listDNSRecords(config.zoneId);

    // Build expected records once (optimization - don't rebuild in loop)
    const expectedRecords = this.buildExpectedRecords(config);

    for (const record of recordsToFix) {
      try {
        // For invalid records, we only add the correct one - don't delete existing
        // This is safer for multi-value records (MX, TXT) where we might delete the wrong one
        // Cloudflare will handle conflicts (e.g., CNAME) by rejecting the create operation

        // Find the expected record details (including priority for MX)
        const expected = expectedRecords.find(
          (r) => r.type === record.type &&
                 this.normalizeRecordName(r.name) === this.normalizeRecordName(record.name) &&
                 r.value === record.value
        );

        // Create record with correct value
        await this.createRecord(client, config, record, expected?.priority);
        fixed.push(`${record.type} ${record.name}`);
      } catch (error) {
        failed.push(`${record.type} ${record.name}: ${(error as Error).message}`);
      }
    }

    return { fixed, failed };
  }

  /**
   * Build expected DNS records from project configuration
   */
  private buildExpectedRecords(config: ExpectedDNSConfig): Array<{
    type: DNSRecordType;
    name: string;
    value: string;
    priority?: number;
  }> {
    const records: Array<{
      type: DNSRecordType;
      name: string;
      value: string;
      priority?: number;
    }> = [];

    // MX records
    if (config.emailProvider || config.customMXRecords) {
      const mxRecords =
        config.customMXRecords ||
        (config.emailProvider && config.emailProvider in DEFAULT_MX_RECORDS
          ? DEFAULT_MX_RECORDS[config.emailProvider as keyof typeof DEFAULT_MX_RECORDS]
          : []);

      for (const mx of mxRecords) {
        let value = mx.value;

        // Handle Microsoft 365 placeholder
        if (config.emailProvider === EmailProvider.MICROSOFT_365) {
          const domainPrefix = config.domain.split('.')[0];
          value = value.replace('<domain>', domainPrefix);
        }

        records.push({
          type: 'MX',
          name: config.domain,
          value,
          priority: mx.priority,
        });
      }
    }

    // SPF record
    if (config.emailProvider || config.customSPF) {
      const spfValue =
        config.customSPF ||
        (config.emailProvider && config.emailProvider in DEFAULT_SPF_RECORDS
          ? DEFAULT_SPF_RECORDS[config.emailProvider as keyof typeof DEFAULT_SPF_RECORDS]
          : 'v=spf1 ~all');

      records.push({
        type: 'TXT',
        name: config.domain,
        value: spfValue,
      });
    }

    // DMARC record
    if (config.emailProvider) {
      records.push({
        type: 'TXT',
        name: `_dmarc.${config.domain}`,
        value: DEFAULT_DMARC_RECORD(config.domain),
      });
    }

    // GitHub Pages CNAME
    if (config.githubOrg) {
      records.push({
        type: 'CNAME',
        name: `www.${config.domain}`,
        value: `${config.githubOrg}.github.io`,
      });
    }

    // Vercel CNAME
    if (config.vercelDomain) {
      records.push({
        type: 'CNAME',
        name: `app.${config.domain}`,
        value: config.vercelDomain,
      });
    }

    // Custom CNAMEs
    if (config.customCNAMEs) {
      for (const cname of config.customCNAMEs) {
        records.push({
          type: 'CNAME',
          name: cname.name,
          value: cname.value,
        });
      }
    }

    return records;
  }

  /**
   * Query DNS record
   */
  private async queryRecord(type: DNSRecordType, name: string): Promise<string[]> {
    switch (type) {
      case 'MX': {
        const mxRecords = await this.resolver.resolveMx(name);
        return mxRecords.map((mx) => mx.exchange);
      }

      case 'TXT': {
        const txtRecords = await this.resolver.resolveTxt(name);
        // Preserve record boundaries - join chunks per TXT record
        return txtRecords.map((record) => record.join(''));
      }

      case 'CNAME': {
        const cnameRecords = await this.resolver.resolveCname(name);
        return Array.isArray(cnameRecords) ? cnameRecords : [cnameRecords];
      }

      case 'A': {
        return await this.resolver.resolve4(name);
      }

      case 'AAAA': {
        return await this.resolver.resolve6(name);
      }

      case 'NS': {
        return await this.resolver.resolveNs(name);
      }

      case 'SOA': {
        const soa = await this.resolver.resolveSoa(name);
        return [soa.nsname];
      }

      default: {
        throw new Error(`Unsupported DNS record type: ${type}`);
      }
    }
  }

  /**
   * Normalize DNS record name for comparison
   * Ensures consistent comparison by removing trailing dots and converting to lowercase
   */
  private normalizeRecordName(name: string): string {
    return name.toLowerCase().trim().replace(/\.$/, '');
  }

  /**
   * Compare expected vs actual records
   */
  private compareRecords(
    expected: { type: DNSRecordType; name: string; value: string },
    actual: string[]
  ): { valid: boolean; error?: string } {
    // Normalize values for comparison (lowercase, trim whitespace, remove trailing dots for DNS names)
    const expectedValue = expected.value.toLowerCase().trim().replace(/\.$/, '');
    const actualValues = actual.map((v) => v.toLowerCase().trim().replace(/\.$/, ''));

    // Use exact match to avoid false positives
    // (e.g., sub.example.com should not match example.com)
    const found = actualValues.some((actual) => actual === expectedValue);

    if (!found) {
      return {
        valid: false,
        error: `Expected value not found. Expected: ${expected.value}, Found: ${actual.join(', ')}`,
      };
    }

    return { valid: true };
  }

  /**
   * Calculate overall health status based on individual record statuses
   */
  private calculateOverallHealth(records: DNSRecord[]): DNSHealthStatus {
    const invalidCount = records.filter((r) => r.status === 'invalid').length;
    const missingCount = records.filter((r) => r.status === 'missing').length;

    if (invalidCount === 0 && missingCount === 0) {
      return 'healthy';
    }

    // Critical if any records are missing
    if (missingCount > 0) {
      return 'critical';
    }

    // Degraded if records exist but are invalid
    return 'degraded';
  }

  /**
   * Create a DNS record via Cloudflare API
   */
  private async createRecord(
    client: CloudflareClient,
    config: ExpectedDNSConfig,
    record: DNSRecord,
    priority?: number
  ): Promise<void> {
    // Build properly typed record input
    const recordInput: {
      type: DNSRecordType;
      name: string;
      content: string;
      ttl: number;
      proxied: boolean;
      priority?: number;
    } = {
      type: record.type as DNSRecordType, // SOA records are managed by Cloudflare
      name: record.name,
      content: record.value,
      ttl: 1, // Automatic
      proxied: false,
    };

    // Add priority for MX records (passed from caller to avoid re-building expected records)
    if (record.type === 'MX' && priority !== undefined) {
      recordInput.priority = priority;
    }

    // Cast to DNSRecordInput to handle SOA type mismatch (SOA records managed by Cloudflare)
    await client.createDNSRecord(config.zoneId, recordInput as Parameters<typeof client.createDNSRecord>[1]);
  }
}

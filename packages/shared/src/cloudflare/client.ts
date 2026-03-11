/**
 * Cloudflare API client
 *
 * TypeScript client for Cloudflare API v4
 * Reference: https://developers.cloudflare.com/api/
 */

import { CloudflareApiError, CloudflareErrorCategory } from './errors.js';
import { CLOUDFLARE_API_URL, REQUEST_TIMEOUT_MS, USER_AGENT } from './constants.js';
import type {
  CloudflareConfig,
  CloudflareApiResponse,
  CloudflareZone,
  DNSRecord,
  DNSRecordInput,
  DNSRecordType,
  ZoneCreateParams,
  TokenVerification,
  CloudflareAccount,
} from './types.js';

/**
 * Cloudflare API client
 */
export class CloudflareClient {
  private readonly config: CloudflareConfig;
  private readonly baseUrl: string;

  constructor(config: CloudflareConfig) {
    this.config = config;
    this.baseUrl = CLOUDFLARE_API_URL;
  }

  /**
   * Execute an API request
   *
   * @param endpoint - API endpoint (e.g., '/zones')
   * @param options - Fetch options
   * @returns Parsed API response
   * @throws CloudflareApiError on API errors
   */
  private async executeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<CloudflareApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      // Handle header merging properly for Headers instances and arrays
      const { headers: _ignoredHeaders, ...optionsWithoutHeaders } = options;
      const headers = new Headers(options.headers ?? {});
      headers.set('Authorization', `Bearer ${this.config.apiToken}`);
      headers.set('Content-Type', 'application/json');
      headers.set('User-Agent', USER_AGENT);

      const response = await fetch(url, {
        ...optionsWithoutHeaders,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle non-OK HTTP responses before parsing JSON
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json() as CloudflareApiResponse<T>;
          if (errorData.errors?.length > 0) {
            throw new CloudflareApiError(errorData.errors);
          }
        } catch (parseError) {
          // If JSON parsing fails, use the HTTP status text
          throw new CloudflareApiError([{
            code: response.status,
            message: errorMessage,
          }]);
        }
      }

      const data = await response.json() as CloudflareApiResponse<T>;

      // Check if the API returned an error in the response
      if (!data.success || data.errors?.length > 0) {
        throw new CloudflareApiError(data.errors || []);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort/timeout - wrap in CloudflareApiError for consistent error handling
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CloudflareApiError(
          [{ code: 0, message: 'Request timeout: Cloudflare API did not respond in time' }],
          CloudflareErrorCategory.NETWORK
        );
      }

      // Re-throw CloudflareApiError and other errors as-is
      throw error;
    }
  }

  /**
   * Verify API token
   *
   * Endpoint: GET /user/tokens/verify
   * Reference: https://developers.cloudflare.com/api/operations/user-api-tokens-verify-token
   *
   * @returns Token verification result
   */
  async verifyToken(): Promise<TokenVerification> {
    const response = await this.executeRequest<TokenVerification>('/user/tokens/verify', {
      method: 'GET',
    });

    return response.result;
  }

  /**
   * List all zones (domains) accessible with the current token
   *
   * Endpoint: GET /zones
   * Reference: https://developers.cloudflare.com/api/operations/zones-get
   *
   * @param accountId - Optional account ID to filter zones
   * @returns Array of zones
   */
  async listZones(accountId?: string): Promise<CloudflareZone[]> {
    const params = new URLSearchParams();
    if (accountId) {
      params.set('account.id', accountId);
    }

    const endpoint = `/zones${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await this.executeRequest<CloudflareZone[]>(endpoint, {
      method: 'GET',
    });

    return response.result;
  }

  /**
   * Get zone details by zone ID
   *
   * Endpoint: GET /zones/:zoneId
   * Reference: https://developers.cloudflare.com/api/operations/zones-0-get
   *
   * @param zoneId - Zone ID
   * @returns Zone details
   */
  async getZoneDetails(zoneId: string): Promise<CloudflareZone> {
    const response = await this.executeRequest<CloudflareZone>(`/zones/${zoneId}`, {
      method: 'GET',
    });

    return response.result;
  }

  /**
   * Create a new zone (domain)
   *
   * Endpoint: POST /zones
   * Reference: https://developers.cloudflare.com/api/operations/zones-post
   *
   * @param params - Zone creation parameters
   * @returns Created zone
   */
  async createZone(params: ZoneCreateParams): Promise<CloudflareZone> {
    const response = await this.executeRequest<CloudflareZone>('/zones', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    return response.result;
  }

  /**
   * Delete a zone
   *
   * Endpoint: DELETE /zones/:zoneId
   * Reference: https://developers.cloudflare.com/api/operations/zones-0-delete
   *
   * @param zoneId - Zone ID
   * @returns Deleted zone ID
   */
  async deleteZone(zoneId: string): Promise<{ id: string }> {
    const response = await this.executeRequest<{ id: string }>(`/zones/${zoneId}`, {
      method: 'DELETE',
    });

    return response.result;
  }

  /**
   * List DNS records for a zone
   *
   * Endpoint: GET /zones/:zoneId/dns_records
   * Reference: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records
   *
   * @param zoneId - Zone ID
   * @param type - Optional record type filter (e.g., 'A', 'MX', 'TXT')
   * @returns Array of DNS records
   */
  async listDNSRecords(zoneId: string, type?: DNSRecordType): Promise<DNSRecord[]> {
    const params = new URLSearchParams();
    if (type) {
      params.set('type', type);
    }

    const endpoint = `/zones/${zoneId}/dns_records${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await this.executeRequest<DNSRecord[]>(endpoint, {
      method: 'GET',
    });

    return response.result;
  }

  /**
   * Create a DNS record
   *
   * Endpoint: POST /zones/:zoneId/dns_records
   * Reference: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record
   *
   * @param zoneId - Zone ID
   * @param record - DNS record data
   * @returns Created DNS record
   */
  async createDNSRecord(zoneId: string, record: DNSRecordInput): Promise<DNSRecord> {
    const response = await this.executeRequest<DNSRecord>(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });

    return response.result;
  }

  /**
   * Update a DNS record
   *
   * Endpoint: PATCH /zones/:zoneId/dns_records/:recordId
   * Reference: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-patch-dns-record
   *
   * @param zoneId - Zone ID
   * @param recordId - DNS record ID
   * @param data - Fields to update
   * @returns Updated DNS record
   */
  async updateDNSRecord(
    zoneId: string,
    recordId: string,
    data: Partial<DNSRecordInput>
  ): Promise<DNSRecord> {
    const response = await this.executeRequest<DNSRecord>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );

    return response.result;
  }

  /**
   * Delete a DNS record
   *
   * Endpoint: DELETE /zones/:zoneId/dns_records/:recordId
   * Reference: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-delete-dns-record
   *
   * @param zoneId - Zone ID
   * @param recordId - DNS record ID
   * @returns Deleted record ID
   */
  async deleteDNSRecord(zoneId: string, recordId: string): Promise<{ id: string }> {
    const response = await this.executeRequest<{ id: string }>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: 'DELETE',
      }
    );

    return response.result;
  }

  /**
   * Get account information
   *
   * Endpoint: GET /accounts/:accountId
   * Reference: https://developers.cloudflare.com/api/operations/accounts-account-details
   *
   * @param accountId - Account ID (uses config.accountId if not provided)
   * @returns Account details
   */
  async getAccount(accountId?: string): Promise<CloudflareAccount> {
    const id = accountId || this.config.accountId;
    if (!id) {
      throw new Error('Account ID required');
    }

    const response = await this.executeRequest<CloudflareAccount>(`/accounts/${id}`, {
      method: 'GET',
    });

    return response.result;
  }

  /**
   * List all accounts accessible with the current token
   *
   * Endpoint: GET /accounts
   * Reference: https://developers.cloudflare.com/api/operations/accounts-list-accounts
   *
   * @returns Array of accounts
   */
  async listAccounts(): Promise<CloudflareAccount[]> {
    const response = await this.executeRequest<CloudflareAccount[]>('/accounts', {
      method: 'GET',
    });

    return response.result;
  }
}

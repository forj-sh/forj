/**
 * Namecheap API client
 *
 * TypeScript client for Namecheap Reseller API
 * Reference: project-docs/namecheap-integration-spec.md Section 4
 */

import { parseResponse } from './xml-parser.js';
import { NAMECHEAP_URLS, REQUEST_TIMEOUT_MS, USER_AGENT } from './constants.js';
import type { NamecheapConfig, NamecheapApiResponse } from './types.js';

/**
 * Namecheap API client
 */
export class NamecheapClient {
  private readonly config: NamecheapConfig;
  private readonly baseUrl: string;

  constructor(config: NamecheapConfig) {
    this.config = config;
    this.baseUrl = config.sandbox ? NAMECHEAP_URLS.SANDBOX : NAMECHEAP_URLS.PRODUCTION;
  }

  /**
   * Build URL with global parameters for Namecheap API
   *
   * @param command - API command (e.g., 'namecheap.domains.check')
   * @param params - Additional command-specific parameters
   * @returns Full URL with query string
   */
  private buildUrl(command: string, params: Record<string, string | undefined> = {}): string {
    const url = new URL(this.baseUrl);

    // Add global parameters (required for every call)
    url.searchParams.set('ApiUser', this.config.apiUser);
    url.searchParams.set('ApiKey', this.config.apiKey);
    url.searchParams.set('UserName', this.config.userName);
    url.searchParams.set('ClientIp', this.config.clientIp);
    url.searchParams.set('Command', command);

    // Add command-specific parameters
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  /**
   * Execute an API request
   *
   * @param command - API command
   * @param params - Command-specific parameters
   * @returns Parsed API response
   * @throws NamecheapApiError on API errors
   */
  protected async executeRequest<T>(
    command: string,
    params: Record<string, string | undefined> = {}
  ): Promise<NamecheapApiResponse<T>> {
    const url = this.buildUrl(command, params);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const result = parseResponse<T>(xml);

      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout: Namecheap API did not respond in time');
      }

      // Re-throw NamecheapApiError and other errors as-is
      throw error;
    }
  }

  /**
   * Get configuration (useful for debugging)
   * Returns a copy with sensitive fields (e.g. apiKey) redacted.
   */
  getConfig(): Readonly<NamecheapConfig> {
    const { apiKey, ...rest } = this.config;
    return {
      ...rest,
      apiKey: '[REDACTED]',
    } as Readonly<NamecheapConfig>;
  }

  /**
   * Check if client is configured for sandbox mode
   */
  isSandbox(): boolean {
    return this.config.sandbox;
  }
}

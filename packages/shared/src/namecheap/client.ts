/**
 * Namecheap API client
 *
 * TypeScript client for Namecheap Reseller API
 * Reference: project-docs/namecheap-integration-spec.md Section 4
 */

import { parseResponse, normalizeArray, parseBoolean, parseNumber, getAttribute } from './xml-parser.js';
import { NAMECHEAP_URLS, REQUEST_TIMEOUT_MS, USER_AGENT } from './constants.js';
import { flattenContactInfo } from './utils.js';
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

  /**
   * Check domain availability
   *
   * API: namecheap.domains.check
   * Reference: project-docs/namecheap-integration-spec.md Section 3.1
   *
   * @param domains - List of domains to check (max 50)
   * @returns Array of domain check results
   * @throws Error for invalid input (empty array or > 50 domains)
   * @throws NamecheapApiError if API request fails
   */
  async checkDomains(domains: string[]): Promise<import('./types.js').DomainCheckResult[]> {
    if (domains.length === 0) {
      throw new Error('At least one domain is required');
    }

    if (domains.length > 50) {
      throw new Error('Maximum 50 domains per check');
    }

    const response = await this.executeRequest('namecheap.domains.check', {
      DomainList: domains.join(','),
    });

    // Parse response
    const domainResults = normalizeArray((response.data as any).DomainCheckResult);

    return domainResults.map((result: any) => ({
      domain: getAttribute(result, 'Domain') || '',
      available: parseBoolean(getAttribute(result, 'Available')),
      isPremium: parseBoolean(getAttribute(result, 'IsPremiumName')),
      premiumRegistrationPrice: parseNumber(getAttribute(result, 'PremiumRegistrationPrice')),
      premiumRenewalPrice: parseNumber(getAttribute(result, 'PremiumRenewalPrice')),
      icannFee: parseNumber(getAttribute(result, 'IcannFee')),
      errorNo: getAttribute(result, 'ErrorNo') || '0',
      description: getAttribute(result, 'Description') || '',
    }));
  }

  /**
   * Get TLD pricing information
   *
   * API: namecheap.users.getPricing
   * Reference: project-docs/namecheap-integration-spec.md Section 3.2
   *
   * @param tld - Optional TLD to filter (e.g., 'COM', 'IO')
   * @param action - Optional action type ('REGISTER', 'RENEW', 'REACTIVATE', 'TRANSFER')
   * @returns Array of TLD pricing information
   * @throws NamecheapApiError if API request fails
   */
  async getTldPricing(
    tld?: string,
    action?: 'REGISTER' | 'RENEW' | 'REACTIVATE' | 'TRANSFER'
  ): Promise<import('./types.js').TldPricing[]> {
    const params: Record<string, string> = {
      ProductType: 'DOMAIN',
      ProductCategory: 'DOMAINS',
    };

    if (action) {
      params.ActionName = action;
    }

    if (tld) {
      params.ProductName = tld.toUpperCase();
    }

    const response = await this.executeRequest('namecheap.users.getPricing', params);

    // Parse nested pricing structure
    const productTypes = normalizeArray((response.data as any).ProductType);

    const pricingResults: import('./types.js').TldPricing[] = [];

    for (const productType of productTypes) {
      const categories = normalizeArray(productType.ProductCategory);

      for (const category of categories) {
        const products = normalizeArray(category.Product);

        for (const product of products) {
          const prices = normalizeArray(product.Price);

          for (const price of prices) {
            pricingResults.push({
              tld: getAttribute(product, 'Name') || '',
              action: getAttribute(price, 'ActionName') || 'REGISTER',
              duration: parseNumber(getAttribute(price, 'Duration')),
              durationType: getAttribute(price, 'DurationType') || 'YEAR',
              wholesalePrice: parseNumber(getAttribute(price, 'Price')),
              retailPrice: parseNumber(getAttribute(price, 'RegularPrice')),
              icannFee: parseNumber(getAttribute(price, 'AdditionalCost')),
              currency: getAttribute(price, 'Currency') || 'USD',
            });
          }
        }
      }
    }

    return pricingResults;
  }

  /**
   * Register a domain
   *
   * API: namecheap.domains.create
   * Reference: project-docs/namecheap-integration-spec.md Section 3.3
   *
   * @param params - Domain creation parameters
   * @returns Domain creation result
   * @throws NamecheapApiError if registration fails
   */
  async createDomain(params: import('./types.js').DomainCreateParams): Promise<import('./types.js').DomainCreateResult> {
    // Build request parameters
    const requestParams: Record<string, string> = {
      DomainName: params.domainName,
      Years: params.years.toString(),
      AddFreeWhoisguard: params.addFreeWhoisguard ? 'yes' : 'no',
      WGEnabled: params.wgEnabled ? 'yes' : 'no',
    };

    // Add nameservers if provided
    if (params.nameservers && params.nameservers.length > 0) {
      requestParams.Nameservers = params.nameservers.join(',');
    }

    // Add premium domain params if applicable
    if (params.isPremiumDomain) {
      if (!params.premiumPrice) {
        throw new Error('premiumPrice is required when isPremiumDomain is true');
      }
      requestParams.IsPremiumDomain = 'true';
      requestParams.PremiumPrice = params.premiumPrice.toString();
    }

    // Add promotion code if provided
    if (params.promotionCode) {
      requestParams.PromotionCode = params.promotionCode;
    }

    // Flatten all contact info
    Object.assign(requestParams, flattenContactInfo(params.registrant, 'Registrant'));
    Object.assign(requestParams, flattenContactInfo(params.tech, 'Tech'));
    Object.assign(requestParams, flattenContactInfo(params.admin, 'Admin'));
    Object.assign(requestParams, flattenContactInfo(params.auxBilling, 'AuxBilling'));

    const response = await this.executeRequest('namecheap.domains.create', requestParams);

    // Parse response
    const result = (response.data as any).DomainCreateResult;

    return {
      domain: getAttribute(result, 'Domain') || '',
      registered: parseBoolean(getAttribute(result, 'Registered')),
      chargedAmount: parseNumber(getAttribute(result, 'ChargedAmount')),
      domainId: parseNumber(getAttribute(result, 'DomainID')),
      orderId: parseNumber(getAttribute(result, 'OrderID')),
      transactionId: parseNumber(getAttribute(result, 'TransactionID')),
      whoisguardEnabled: parseBoolean(getAttribute(result, 'WhoisguardEnable')),
      nonRealTimeDomain: parseBoolean(getAttribute(result, 'NonRealTimeDomain')),
    };
  }

  /**
   * Set custom nameservers for a domain
   *
   * API: namecheap.domains.dns.setCustom
   * Reference: project-docs/namecheap-integration-spec.md Section 3.4
   *
   * @param sld - Second-level domain (e.g., 'example' for 'example.com')
   * @param tld - Top-level domain (e.g., 'com')
   * @param nameservers - Array of nameserver hostnames
   * @returns True if update succeeded
   * @throws NamecheapApiError if update fails
   */
  async setCustomNameservers(sld: string, tld: string, nameservers: string[]): Promise<boolean> {
    if (nameservers.length === 0) {
      throw new Error('At least one nameserver is required');
    }

    const response = await this.executeRequest('namecheap.domains.dns.setCustom', {
      SLD: sld,
      TLD: tld,
      Nameservers: nameservers.join(','),
    });

    const result = (response.data as any).DomainDNSSetCustomResult;

    return parseBoolean(getAttribute(result, 'Updated'));
  }

  /**
   * Get domain information
   *
   * API: namecheap.domains.getInfo
   * Reference: project-docs/namecheap-integration-spec.md Section 3.5
   *
   * @param domainName - Full domain name
   * @returns Domain information
   * @throws NamecheapApiError if request fails
   */
  async getDomainInfo(domainName: string): Promise<import('./types.js').DomainInfo> {
    const response = await this.executeRequest('namecheap.domains.getInfo', {
      DomainName: domainName,
    });

    const result = (response.data as any).DomainGetInfoResult;

    const status = getAttribute(result, 'Status');
    if (!status) {
      throw new Error('API response missing required Status field');
    }

    return {
      status: status as 'OK' | 'Locked' | 'Expired',
      id: parseNumber(getAttribute(result, 'ID')),
      domainName: getAttribute(result, 'DomainName') || '',
      ownerName: getAttribute(result, 'OwnerName') || '',
      isOwner: parseBoolean(getAttribute(result, 'IsOwner')),
      isPremium: parseBoolean(getAttribute(result, 'IsPremium')),
    };
  }

  /**
   * Renew a domain
   *
   * API: namecheap.domains.renew
   * Reference: project-docs/namecheap-integration-spec.md Section 3.6
   *
   * @param params - Domain renewal parameters
   * @returns Domain renewal result
   * @throws NamecheapApiError if renewal fails
   */
  async renewDomain(params: import('./types.js').DomainRenewParams): Promise<import('./types.js').DomainRenewResult> {
    const requestParams: Record<string, string> = {
      DomainName: params.domainName,
      Years: params.years.toString(),
    };

    if (params.isPremiumDomain) {
      if (!params.premiumPrice) {
        throw new Error('premiumPrice is required when isPremiumDomain is true');
      }
      requestParams.IsPremiumDomain = 'true';
      requestParams.PremiumPrice = params.premiumPrice.toString();
    }

    if (params.promotionCode) {
      requestParams.PromotionCode = params.promotionCode;
    }

    const response = await this.executeRequest('namecheap.domains.renew', requestParams);

    const result = (response.data as any).DomainRenewResult;

    return {
      domainName: getAttribute(result, 'DomainName') || '',
      domainId: parseNumber(getAttribute(result, 'DomainID')),
      renewed: parseBoolean(getAttribute(result, 'Renew')),
      chargedAmount: parseNumber(getAttribute(result, 'ChargedAmount')),
      orderId: parseNumber(getAttribute(result, 'OrderID')),
      transactionId: parseNumber(getAttribute(result, 'TransactionID')),
    };
  }

  /**
   * Get account balance information
   *
   * API: namecheap.users.getBalances
   * Reference: project-docs/namecheap-integration-spec.md Section 3.7
   *
   * @returns Account balance information
   * @throws NamecheapApiError if request fails
   */
  async getBalances(): Promise<import('./types.js').AccountBalances> {
    const response = await this.executeRequest('namecheap.users.getBalances', {});

    const result = (response.data as any).UserGetBalancesResult;

    const currency = getAttribute(result, 'Currency');
    if (!currency) {
      throw new Error('API response missing required Currency field');
    }

    return {
      currency,
      availableBalance: parseNumber(getAttribute(result, 'AvailableBalance')),
      accountBalance: parseNumber(getAttribute(result, 'AccountBalance')),
      fundsRequiredForAutoRenew: parseNumber(getAttribute(result, 'FundsRequiredForAutoRenew')),
    };
  }

  /**
   * List domains in account
   *
   * API: namecheap.domains.getList
   * Reference: project-docs/namecheap-integration-spec.md Section 3.8
   *
   * @param params - Optional filtering and pagination parameters
   * @returns Domain list result
   * @throws NamecheapApiError if request fails
   */
  async listDomains(params?: import('./types.js').DomainListParams): Promise<import('./types.js').DomainListResult> {
    const requestParams: Record<string, string> = {};

    if (params?.listType) {
      requestParams.ListType = params.listType;
    }
    if (params?.searchTerm) {
      requestParams.SearchTerm = params.searchTerm;
    }
    if (params?.page) {
      requestParams.Page = params.page.toString();
    }
    if (params?.pageSize) {
      requestParams.PageSize = params.pageSize.toString();
    }
    if (params?.sortBy) {
      requestParams.SortBy = params.sortBy;
    }

    const response = await this.executeRequest('namecheap.domains.getList', requestParams);

    const commandResponse = response.data as any;
    const result = commandResponse.DomainGetListResult;
    const paging = commandResponse.Paging;
    const domains = normalizeArray(result?.Domain);

    return {
      domains: domains.map((domain: any) => ({
        id: parseNumber(getAttribute(domain, 'ID')),
        name: getAttribute(domain, 'Name') || '',
        user: getAttribute(domain, 'User') || '',
        created: getAttribute(domain, 'Created') || '',
        expires: getAttribute(domain, 'Expires') || '',
        isExpired: parseBoolean(getAttribute(domain, 'IsExpired')),
        isLocked: parseBoolean(getAttribute(domain, 'IsLocked')),
        autoRenew: parseBoolean(getAttribute(domain, 'AutoRenew')),
        whoisGuard: getAttribute(domain, 'WhoisGuard') || '',
        isPremium: parseBoolean(getAttribute(domain, 'IsPremium')),
        isOurDNS: parseBoolean(getAttribute(domain, 'IsOurDNS')),
      })),
      totalItems: parseNumber(getAttribute(paging, 'TotalItems')),
      currentPage: parseNumber(getAttribute(paging, 'CurrentPage')),
      pageSize: parseNumber(getAttribute(paging, 'PageSize')),
    };
  }
}

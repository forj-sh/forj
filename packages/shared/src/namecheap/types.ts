/**
 * Namecheap API TypeScript types
 *
 * Based on the Namecheap API specification:
 * https://www.namecheap.com/support/api/methods/
 */

/**
 * Namecheap client configuration
 */
export interface NamecheapConfig {
  apiUser: string;      // Namecheap API username
  apiKey: string;       // Namecheap API key
  userName: string;     // Same as apiUser for reseller accounts
  clientIp: string;     // Server IP (must be whitelisted, IPv4 only)
  sandbox: boolean;     // true = sandbox, false = production
}

/**
 * Generic Namecheap API response envelope
 *
 * Note: Renamed from `ApiResponse` to avoid conflict with the general-purpose
 * `ApiResponse` type in packages/shared/src/api.ts
 */
export interface NamecheapApiResponse<T> {
  status: 'OK' | 'ERROR';
  command: string;
  data: T;
  executionTime: number;
}

/**
 * Contact information for domain registration
 * Used for Registrant, Tech, Admin, and AuxBilling contacts
 */
export interface ContactInfo {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;              // ISO 2-letter code (e.g., 'US')
  phone: string;                // Format: +NNN.NNNNNNNNNN
  phoneExt?: string;
  fax?: string;
  emailAddress: string;
  organizationName?: string;
  jobTitle?: string;
}

/**
 * Domain availability check result (from namecheap.domains.check)
 */
export interface DomainCheckResult {
  domain: string;
  available: boolean;
  isPremium: boolean;
  premiumRegistrationPrice: number;
  premiumRenewalPrice: number;
  icannFee: number;
  errorNo: string;
  description: string;
}

/**
 * TLD pricing information (from namecheap.users.getPricing)
 */
export interface TldPricing {
  tld: string;                  // e.g., 'COM', 'IO', 'DEV'
  action: string;               // 'REGISTER', 'RENEW', 'TRANSFER'
  duration: number;             // Registration duration
  durationType: string;         // Usually 'YEAR'
  wholesalePrice: number;       // Our cost (Price field in API)
  retailPrice: number;          // MSRP (RegularPrice field in API)
  icannFee: number;            // Additional ICANN fee
  currency: string;             // Currency code (e.g., 'USD')
}

/**
 * Domain creation parameters (for namecheap.domains.create)
 */
export interface DomainCreateParams {
  domainName: string;
  years: number;                        // Always 1 for Forj
  nameservers?: string[];               // Cloudflare NS if available
  addFreeWhoisguard: boolean;          // Always true for Forj
  wgEnabled: boolean;                   // Always true for Forj
  isPremiumDomain?: boolean;
  premiumPrice?: number;
  registrant: ContactInfo;              // Customer's contact info
  tech: ContactInfo;                    // Forj's contact info
  admin: ContactInfo;                   // Forj's contact info
  auxBilling: ContactInfo;              // Forj's contact info
  promotionCode?: string;
}

/**
 * Domain creation result (from namecheap.domains.create)
 */
export interface DomainCreateResult {
  domain: string;
  registered: boolean;
  chargedAmount: number;
  domainId: number;
  orderId: number;
  transactionId: number;
  whoisguardEnabled: boolean;
  nonRealTimeDomain: boolean;           // If true, poll getDomainInfo until ready
}

/**
 * Domain information (from namecheap.domains.getInfo)
 */
export interface DomainInfo {
  status: 'OK' | 'Locked' | 'Expired';
  id: number;
  domainName: string;
  ownerName: string;
  isOwner: boolean;
  isPremium: boolean;
}

/**
 * Domain renewal parameters (for namecheap.domains.renew)
 */
export interface DomainRenewParams {
  domainName: string;
  years: number;                        // Always 1 for Forj
  isPremiumDomain?: boolean;
  premiumPrice?: number;
  promotionCode?: string;
}

/**
 * Domain renewal result (from namecheap.domains.renew)
 */
export interface DomainRenewResult {
  domainName: string;
  domainId: number;
  renewed: boolean;
  chargedAmount: number;
  orderId: number;
  transactionId: number;
}

/**
 * Account balance information (from namecheap.users.getBalances)
 */
export interface AccountBalances {
  currency: string;
  availableBalance: number;
  accountBalance: number;
  fundsRequiredForAutoRenew: number;
}

/**
 * Domain list parameters (for namecheap.domains.getList)
 */
export interface DomainListParams {
  listType?: 'ALL' | 'EXPIRING' | 'EXPIRED';
  searchTerm?: string;
  page?: number;
  pageSize?: number;                    // 10-100, default 20
  sortBy?: 'NAME' | 'NAME_DESC' | 'EXPIREDATE' | 'EXPIREDATE_DESC' | 'CREATEDATE' | 'CREATEDATE_DESC';
}

/**
 * Domain list item (from namecheap.domains.getList)
 */
export interface DomainListItem {
  id: number;
  name: string;
  user: string;
  created: string;
  expires: string;
  isExpired: boolean;
  isLocked: boolean;
  autoRenew: boolean;
  whoisGuard: string;
  isPremium: boolean;
  isOurDNS: boolean;
}

/**
 * Domain list result (from namecheap.domains.getList)
 */
export interface DomainListResult {
  domains: DomainListItem[];
  totalItems: number;
  currentPage: number;
  pageSize: number;
}

/**
 * Parsed error from Namecheap API response
 */
export interface NamecheapError {
  number: string;
  message: string;
}

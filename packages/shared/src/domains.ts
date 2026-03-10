/**
 * Domain-related types
 */

/**
 * Domain availability option
 */
export interface DomainOption {
  name: string;
  price: string;
  available: boolean;
  registrar?: string;
}

/**
 * Domain availability check request
 * POST /domains/check
 */
export interface DomainCheckRequest {
  query: string;
}

/**
 * Domain availability check response
 */
export interface DomainCheckResponse {
  domains: DomainOption[];
}

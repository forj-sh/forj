import type { ServiceType } from './services.js';

/**
 * Project creation request (Phase 1: domain purchase)
 * POST /projects/create
 */
export interface ProjectCreateRequest {
  name: string;
  domain: string;
}

/**
 * Project creation response
 */
export interface ProjectCreateResponse {
  projectId: string;
}

/**
 * ICANN-required contact information for domain registration
 *
 * Fields match Namecheap ContactInfo but use 'email' instead of 'emailAddress'
 * for consistency with the rest of the Forj API. The orchestrator maps
 * 'email' → 'emailAddress' when building Namecheap job data.
 */
export interface RegistrantContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;            // Format: +NNN.NNNNNNNNNN
  address1: string;
  address2?: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;           // ISO 2-letter code (e.g., 'US')
  organizationName?: string;
}

/**
 * Contact info submission request
 * POST /projects/:id/contact-info
 */
export interface ContactInfoRequest {
  contact: RegistrantContact;
  useWhoisPrivacy: boolean;
}

/**
 * Project phase — tracks where the project is in the two-phase init flow
 */
export type ProjectPhase = 'domain' | 'services' | 'complete';

/** Constants for ProjectPhase values (use in SQL queries, comparisons) */
export const PROJECT_PHASE = {
  DOMAIN: 'domain' as ProjectPhase,
  SERVICES: 'services' as ProjectPhase,
  COMPLETE: 'complete' as ProjectPhase,
} as const;

/**
 * Stripe payment status for domain checkout
 */
export type StripePaymentStatus = 'pending' | 'paid' | 'failed';

/** Constants for StripePaymentStatus values */
export const STRIPE_PAYMENT_STATUS = {
  PENDING: 'pending' as StripePaymentStatus,
  PAID: 'paid' as StripePaymentStatus,
  FAILED: 'failed' as StripePaymentStatus,
} as const;

/** Services that can only be provisioned in Phase 1 (domain purchase) */
export const PHASE1_ONLY_SERVICES: readonly ServiceType[] = ['domain'] as const;

/**
 * Domain name format regex (RFC 1035 labels with TLD required).
 * Shared across API routes and CLI validators.
 */
export const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * Validate domain name format
 */
export function isValidDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that a RegistrantContact has all required ICANN fields.
 * Rejects whitespace-only strings.
 */
export function validateRegistrantContact(contact: Partial<RegistrantContact>): contact is RegistrantContact {
  return (
    isNonEmptyString(contact.firstName) &&
    isNonEmptyString(contact.lastName) &&
    isNonEmptyString(contact.email) &&
    isNonEmptyString(contact.phone) &&
    isNonEmptyString(contact.address1) &&
    isNonEmptyString(contact.city) &&
    isNonEmptyString(contact.stateProvince) &&
    isNonEmptyString(contact.postalCode) &&
    isNonEmptyString(contact.country)
  );
}

/**
 * Add services request (Phase 2: after domain is registered)
 * POST /projects/:id/provision-services
 */
export interface AddServicesRequest {
  services: ServiceType[];
  githubOrg?: string;
}

/**
 * Add services response
 */
export interface AddServicesResponse {
  projectId: string;
}

// ──────────────────────────────────────────────
// Legacy types (deprecated — use phased endpoints)
// ──────────────────────────────────────────────

/**
 * @deprecated Use ProjectCreateRequest + AddServicesRequest instead
 * POST /projects/init
 */
export interface ProjectInitRequest {
  name: string;
  domain: string;
  services: ServiceType[];
  githubOrg?: string;
}

/**
 * @deprecated Use ProjectCreateResponse instead
 */
export interface ProjectInitResponse {
  projectId: string;
}

/**
 * @deprecated Use AddServicesRequest instead
 */
export interface AddServiceRequest {
  service: ServiceType;
}

/**
 * @deprecated Use AddServicesResponse instead
 */
export interface AddServiceResponse {
  message: string;
}

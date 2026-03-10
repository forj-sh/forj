/**
 * Namecheap API utility functions
 */

import { parsePhoneNumber } from 'libphonenumber-js';
import type { ContactInfo } from './types.js';

/**
 * Flatten contact info to Namecheap API parameters
 *
 * Namecheap requires separate parameters for each contact field with a prefix
 * Example: RegistrantFirstName, TechFirstName, AdminFirstName, AuxBillingFirstName
 *
 * @param contact - Contact information
 * @param prefix - Parameter prefix (Registrant, Tech, Admin, AuxBilling)
 * @returns Flattened parameters
 */
export function flattenContactInfo(
  contact: ContactInfo,
  prefix: string
): Record<string, string> {
  const params: Record<string, string> = {
    [`${prefix}FirstName`]: contact.firstName,
    [`${prefix}LastName`]: contact.lastName,
    [`${prefix}Address1`]: contact.address1,
    [`${prefix}City`]: contact.city,
    [`${prefix}StateProvince`]: contact.stateProvince,
    [`${prefix}PostalCode`]: contact.postalCode,
    [`${prefix}Country`]: contact.country,
    [`${prefix}Phone`]: contact.phone,
    [`${prefix}EmailAddress`]: contact.emailAddress,
  };

  // Optional fields
  if (contact.address2) {
    params[`${prefix}Address2`] = contact.address2;
  }
  if (contact.phoneExt) {
    params[`${prefix}PhoneExt`] = contact.phoneExt;
  }
  if (contact.fax) {
    params[`${prefix}Fax`] = contact.fax;
  }
  if (contact.organizationName) {
    params[`${prefix}OrganizationName`] = contact.organizationName;
  }
  if (contact.jobTitle) {
    params[`${prefix}JobTitle`] = contact.jobTitle;
  }

  return params;
}

/**
 * Split domain into SLD (second-level domain) and TLD (top-level domain)
 *
 * Handles multi-level TLDs like .co.uk, .com.au, etc.
 *
 * **Note**: The multiLevelTlds list is not exhaustive and covers only the most common
 * multi-level TLDs. For less common TLDs (e.g., .gov.uk, .sch.uk, .pvt.k12.ma.us),
 * this function will treat them as standard single-level TLDs. If you need to support
 * additional multi-level TLDs, consider using a comprehensive Public Suffix List library
 * like `psl` (npm package) for production use.
 *
 * @param domain - Full domain name (e.g., 'example.com', 'example.co.uk')
 * @returns Object with sld and tld
 */
export function splitDomain(domain: string): { sld: string; tld: string } {
  const parts = domain.toLowerCase().split('.');

  if (parts.length < 2) {
    throw new Error(`Invalid domain: ${domain}`);
  }

  // Multi-level TLDs (most common ones)
  const multiLevelTlds = [
    'co.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za',
    'com.br', 'com.ar', 'com.mx', 'co.jp', 'co.in',
    'org.uk', 'me.uk', 'nom.es', 'com.es', 'org.es',
  ];

  // Check if domain has a multi-level TLD
  if (parts.length >= 3) {
    const possibleTld = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (multiLevelTlds.includes(possibleTld)) {
      return {
        sld: parts.slice(0, -2).join('.'),
        tld: possibleTld,
      };
    }
  }

  // Standard TLD (e.g., .com, .io, .dev)
  return {
    sld: parts.slice(0, -1).join('.'),
    tld: parts[parts.length - 1],
  };
}

/**
 * Format phone number to Namecheap required format: +NNN.NNNNNNNNNN
 *
 * @param phone - Phone number in various formats
 * @param defaultCountry - Default country code if not provided (default: 'US')
 * @returns Formatted phone number
 * @throws Error if phone number is invalid
 */
export function formatPhoneNumber(phone: string, defaultCountry: string = 'US'): string {
  try {
    // Parse phone number with proper type
    const phoneNumber = parsePhoneNumber(phone, defaultCountry.toUpperCase() as 'US' | 'CA' | 'GB');

    if (!phoneNumber || !phoneNumber.isValid()) {
      throw new Error(`Invalid phone number: ${phone}`);
    }

    // Use libphonenumber-js fields to build Namecheap format: +<countryCallingCode>.<nationalNumber>
    const countryCallingCode = phoneNumber.countryCallingCode;
    const nationalNumber = phoneNumber.nationalNumber;

    if (!countryCallingCode || !nationalNumber) {
      throw new Error(`Invalid phone number structure for: ${phone}`);
    }

    return `+${countryCallingCode}.${nationalNumber}`;
  } catch (error) {
    throw new Error(`Failed to format phone number: ${phone}. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

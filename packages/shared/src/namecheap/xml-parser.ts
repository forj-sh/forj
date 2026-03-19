/**
 * Namecheap XML response parser
 *
 * Uses fast-xml-parser to convert Namecheap XML responses to JavaScript objects
 * Reference: docs/namecheap-integration.md Section 4.4
 */

import { XMLParser } from 'fast-xml-parser';
import { NamecheapApiError } from './errors.js';
import type { NamecheapApiResponse, NamecheapError } from './types.js';

/**
 * XML parser instance configured for Namecheap responses
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // Parse Namecheap's boolean strings to actual booleans
  tagValueProcessor: (_tagName, tagValue) => {
    if (tagValue === 'true' || tagValue === 'True') return true;
    if (tagValue === 'false' || tagValue === 'False') return false;
    return tagValue;
  },
  // Parse number strings to numbers
  numberParseOptions: {
    leadingZeros: false,
    hex: false,
    skipLike: /^[+-]?\d+\.\d+$/, // Don't parse floats here, we'll handle them manually
  },
});

/**
 * Parse a Namecheap XML response
 *
 * @param xml - Raw XML string from Namecheap API
 * @returns Parsed API response
 * @throws NamecheapApiError if response contains errors
 */
export function parseResponse<T>(xml: string): NamecheapApiResponse<T> {
  try {
    const parsed = parser.parse(xml);
    const apiResponse = parsed.ApiResponse;

    if (!apiResponse) {
      throw new Error('Invalid XML response: Missing ApiResponse element');
    }

    // Check for error status
    if (apiResponse.Status === 'ERROR') {
      const errors = normalizeErrors(apiResponse.Errors);
      throw new NamecheapApiError(errors);
    }

    // Extract response data
    return {
      status: apiResponse.Status,
      command: apiResponse.RequestedCommand,
      data: apiResponse.CommandResponse,
      executionTime: parseFloat(apiResponse.ExecutionTime || '0'),
    };
  } catch (error) {
    if (error instanceof NamecheapApiError) {
      throw error;
    }
    throw new Error(`Failed to parse Namecheap XML response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Normalize error elements to an array
 *
 * Namecheap returns errors as either a single Error object or an array
 * This function normalizes to always return an array
 */
function normalizeErrors(errorsObj: any): NamecheapError[] {
  if (!errorsObj || !errorsObj.Error) {
    return [{ number: '0', message: 'Unknown error' }];
  }

  const errorElements = Array.isArray(errorsObj.Error)
    ? errorsObj.Error
    : [errorsObj.Error];

  return errorElements.map((err: any) => ({
    number: String(err.Number ?? err['@Number'] ?? '0'),
    message: typeof err === 'string' ? err : (err['#text'] || err.toString()),
  }));
}

/**
 * Normalize array-like response elements
 *
 * Namecheap returns single items as objects, multiple items as arrays
 * This function normalizes to always return an array
 */
export function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse boolean attribute from XML
 *
 * Namecheap uses various boolean representations:
 * - "true", "True", "TRUE"
 * - "false", "False", "FALSE"
 */
export function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
}

/**
 * Parse number attribute from XML
 *
 * Handles both integer and float values
 */
export function parseNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Extract attribute value from XML element
 *
 * fast-xml-parser can store attributes with or without prefix
 * This function handles both cases
 */
export function getAttribute(element: any, attrName: string): any {
  if (!element) return undefined;

  // Try direct property access first
  if (element[attrName] !== undefined) {
    return element[attrName];
  }

  // Try with @ prefix (fast-xml-parser default)
  if (element[`@${attrName}`] !== undefined) {
    return element[`@${attrName}`];
  }

  // Try with @ prefix and camelCase
  const camelCase = attrName.charAt(0).toUpperCase() + attrName.slice(1);
  if (element[`@${camelCase}`] !== undefined) {
    return element[`@${camelCase}`];
  }

  return undefined;
}

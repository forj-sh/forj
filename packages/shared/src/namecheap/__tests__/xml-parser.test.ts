/**
 * Unit tests for Namecheap XML parser
 */

import { describe, it, expect } from '@jest/globals';
import {
  parseResponse,
  normalizeArray,
  parseBoolean,
  parseNumber,
  getAttribute,
} from '../xml-parser.js';
import { NamecheapApiError, NamecheapErrorCategory } from '../errors.js';

describe('parseResponse', () => {
  it('should parse a successful XML response', () => {
    const xml = `
      <ApiResponse Status="OK">
        <Errors/>
        <Warnings/>
        <RequestedCommand>namecheap.domains.check</RequestedCommand>
        <CommandResponse Type="namecheap.domains.check">
          <DomainCheckResult Domain="example.com" Available="true"/>
        </CommandResponse>
        <Server>PHX01APIEXT02</Server>
        <GMTTimeDifference>--4:00</GMTTimeDifference>
        <ExecutionTime>1.358</ExecutionTime>
      </ApiResponse>
    `;

    const result = parseResponse(xml);

    expect(result.status).toBe('OK');
    expect(result.command).toBe('namecheap.domains.check');
    expect(result.executionTime).toBe(1.358);
    expect(result.data).toBeDefined();
  });

  it('should throw NamecheapApiError on error response', () => {
    const xml = `
      <ApiResponse Status="ERROR">
        <Errors>
          <Error Number="2011169">Only 50 domains are allowed in a single check command</Error>
        </Errors>
        <RequestedCommand>namecheap.domains.check</RequestedCommand>
      </ApiResponse>
    `;

    expect(() => parseResponse(xml)).toThrow(NamecheapApiError);

    try {
      parseResponse(xml);
    } catch (error) {
      expect(error).toBeInstanceOf(NamecheapApiError);
      const apiError = error as NamecheapApiError;
      expect(apiError.errors).toHaveLength(1);
      expect(apiError.errors[0].number).toBe('2011169');
      expect(apiError.category).toBe(NamecheapErrorCategory.VALIDATION);
    }
  });

  it('should handle multiple errors in response', () => {
    const xml = `
      <ApiResponse Status="ERROR">
        <Errors>
          <Error Number="2015182">Phone format invalid</Error>
          <Error Number="2011170">Invalid promotion code</Error>
        </Errors>
        <RequestedCommand>namecheap.domains.create</RequestedCommand>
      </ApiResponse>
    `;

    expect.assertions(4);

    try {
      parseResponse(xml);
    } catch (error) {
      expect(error).toBeInstanceOf(NamecheapApiError);
      const apiError = error as NamecheapApiError;
      expect(apiError.errors).toHaveLength(2);
      expect(apiError.errors[0].number).toBe('2015182');
      expect(apiError.errors[1].number).toBe('2011170');
    }
  });

  it('should throw error for invalid XML', () => {
    const xml = 'not valid xml';

    expect(() => parseResponse(xml)).toThrow();
  });
});

describe('normalizeArray', () => {
  it('should return empty array for undefined', () => {
    expect(normalizeArray(undefined)).toEqual([]);
  });

  it('should return array as-is', () => {
    const input = [{ id: 1 }, { id: 2 }];
    expect(normalizeArray(input)).toEqual(input);
  });

  it('should wrap single object in array', () => {
    const input = { id: 1 };
    expect(normalizeArray(input)).toEqual([input]);
  });
});

describe('parseBoolean', () => {
  it('should parse "true" string to boolean', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('True')).toBe(true);
    expect(parseBoolean('TRUE')).toBe(true);
  });

  it('should parse "false" string to boolean', () => {
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('False')).toBe(false);
    expect(parseBoolean('FALSE')).toBe(false);
  });

  it('should return boolean as-is', () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
  });

  it('should return false for other values', () => {
    expect(parseBoolean('yes')).toBe(false);
    expect(parseBoolean('1')).toBe(false);
    expect(parseBoolean(null)).toBe(false);
  });
});

describe('parseNumber', () => {
  it('should parse string numbers', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('3.14')).toBe(3.14);
    expect(parseNumber('0')).toBe(0);
  });

  it('should return number as-is', () => {
    expect(parseNumber(42)).toBe(42);
    expect(parseNumber(3.14)).toBe(3.14);
  });

  it('should return 0 for non-numeric values', () => {
    expect(parseNumber('not a number')).toBe(0);
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
  });
});

describe('getAttribute', () => {
  it('should extract attribute without prefix', () => {
    const element = { Domain: 'example.com' };
    expect(getAttribute(element, 'Domain')).toBe('example.com');
  });

  it('should extract attribute with @ prefix', () => {
    const element = { '@Domain': 'example.com' };
    expect(getAttribute(element, 'Domain')).toBe('example.com');
  });

  it('should return undefined for missing attribute', () => {
    const element = { Domain: 'example.com' };
    expect(getAttribute(element, 'NotFound')).toBeUndefined();
  });

  it('should return undefined for null element', () => {
    expect(getAttribute(null, 'Domain')).toBeUndefined();
  });
});

/**
 * Unit tests for Namecheap error handling
 */

import { describe, it, expect } from '@jest/globals';
import {
  NamecheapApiError,
  NamecheapErrorCategory,
  categorizeError,
} from '../errors.js';
import type { NamecheapError } from '../types.js';

describe('categorizeError', () => {
  it('should categorize AUTH errors correctly', () => {
    expect(categorizeError('1010101')).toBe(NamecheapErrorCategory.AUTH);
    expect(categorizeError('1010102')).toBe(NamecheapErrorCategory.AUTH);
    expect(categorizeError('1017101')).toBe(NamecheapErrorCategory.AUTH);
    expect(categorizeError('1017411')).toBe(NamecheapErrorCategory.AUTH);
  });

  it('should categorize VALIDATION errors correctly', () => {
    expect(categorizeError('2011169')).toBe(NamecheapErrorCategory.VALIDATION);
    expect(categorizeError('2011170')).toBe(NamecheapErrorCategory.VALIDATION);
    expect(categorizeError('2015182')).toBe(NamecheapErrorCategory.VALIDATION);
    expect(categorizeError('2015167')).toBe(NamecheapErrorCategory.VALIDATION);
  });

  it('should categorize PAYMENT errors correctly', () => {
    expect(categorizeError('2033409')).toBe(NamecheapErrorCategory.PAYMENT);
    expect(categorizeError('2033407')).toBe(NamecheapErrorCategory.PAYMENT);
    expect(categorizeError('2528166')).toBe(NamecheapErrorCategory.PAYMENT);
  });

  it('should categorize AVAILABILITY errors correctly', () => {
    expect(categorizeError('3019166')).toBe(NamecheapErrorCategory.AVAILABILITY);
    expect(categorizeError('4019166')).toBe(NamecheapErrorCategory.AVAILABILITY);
  });

  it('should categorize PROVIDER errors correctly', () => {
    expect(categorizeError('3031166')).toBe(NamecheapErrorCategory.PROVIDER);
    expect(categorizeError('3031510')).toBe(NamecheapErrorCategory.PROVIDER);
    expect(categorizeError('3050900')).toBe(NamecheapErrorCategory.PROVIDER);
  });

  it('should categorize UNKNOWN errors correctly', () => {
    expect(categorizeError('5019169')).toBe(NamecheapErrorCategory.UNKNOWN);
    expect(categorizeError('9999999')).toBe(NamecheapErrorCategory.UNKNOWN);
  });
});

describe('NamecheapApiError', () => {
  it('should create error with single error object', () => {
    const errors: NamecheapError[] = [
      { number: '2011169', message: 'Only 50 domains allowed' },
    ];

    const error = new NamecheapApiError(errors);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NamecheapApiError');
    expect(error.errors).toEqual(errors);
    expect(error.category).toBe(NamecheapErrorCategory.VALIDATION);
    expect(error.message).toContain('[VALIDATION]');
    expect(error.message).toContain('[2011169]');
    expect(error.message).toContain('Only 50 domains allowed');
  });

  it('should create error with multiple error objects', () => {
    const errors: NamecheapError[] = [
      { number: '2015182', message: 'Phone format invalid' },
      { number: '2011170', message: 'Invalid promotion code' },
    ];

    const error = new NamecheapApiError(errors);

    expect(error.errors).toHaveLength(2);
    expect(error.message).toContain('[2015182]');
    expect(error.message).toContain('[2011170]');
  });

  it('should allow manual category override', () => {
    const errors: NamecheapError[] = [
      { number: '9999999', message: 'Unknown error' },
    ];

    const error = new NamecheapApiError(errors, NamecheapErrorCategory.PROVIDER);

    expect(error.category).toBe(NamecheapErrorCategory.PROVIDER);
  });

  describe('isRetryable', () => {
    it('should return true for PROVIDER errors', () => {
      const errors: NamecheapError[] = [
        { number: '3031166', message: 'Upstream provider error' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.isRetryable()).toBe(true);
    });

    it('should return true for UNKNOWN errors', () => {
      const errors: NamecheapError[] = [
        { number: '9999999', message: 'Unknown error' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.isRetryable()).toBe(true);
    });

    it('should return false for AUTH errors', () => {
      const errors: NamecheapError[] = [
        { number: '1017101', message: 'ApiUser disabled' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.isRetryable()).toBe(false);
    });

    it('should return false for VALIDATION errors', () => {
      const errors: NamecheapError[] = [
        { number: '2015182', message: 'Phone format invalid' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.isRetryable()).toBe(false);
    });

    it('should return false for AVAILABILITY errors', () => {
      const errors: NamecheapError[] = [
        { number: '3019166', message: 'Domain not available' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.isRetryable()).toBe(false);
    });
  });

  describe('getUserMessage', () => {
    it('should return appropriate message for AUTH errors', () => {
      const errors: NamecheapError[] = [
        { number: '1017101', message: 'ApiUser disabled' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.getUserMessage()).toContain('Infrastructure error');
    });

    it('should return appropriate message for VALIDATION errors', () => {
      const errors: NamecheapError[] = [
        { number: '2015182', message: 'Phone format invalid' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.getUserMessage()).toContain('Invalid input');
    });

    it('should return appropriate message for PAYMENT errors', () => {
      const errors: NamecheapError[] = [
        { number: '2033409', message: 'Order error' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.getUserMessage()).toContain('Payment processing error');
    });

    it('should return appropriate message for AVAILABILITY errors', () => {
      const errors: NamecheapError[] = [
        { number: '3019166', message: 'Domain not available' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.getUserMessage()).toContain('no longer available');
    });

    it('should return appropriate message for PROVIDER errors', () => {
      const errors: NamecheapError[] = [
        { number: '3031166', message: 'Upstream provider error' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.getUserMessage()).toContain('retrying automatically');
    });

    it('should return appropriate message for UNKNOWN errors', () => {
      const errors: NamecheapError[] = [
        { number: '9999999', message: 'Unknown error' },
      ];
      const error = new NamecheapApiError(errors);
      expect(error.getUserMessage()).toContain('Unexpected error');
    });
  });
});

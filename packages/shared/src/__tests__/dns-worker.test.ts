/**
 * Unit tests for DNS worker state machine
 */

import { describe, it, expect } from '@jest/globals';
import {
  DNSJobStatus,
  isValidStateTransition,
  isTerminalState,
  isRetryableState,
} from '../dns-worker.js';

describe('DNS Worker State Machine', () => {
  describe('isValidStateTransition', () => {
    it('should allow PENDING → QUEUED', () => {
      expect(isValidStateTransition(DNSJobStatus.PENDING, DNSJobStatus.QUEUED)).toBe(true);
    });

    it('should allow PENDING → FAILED', () => {
      expect(isValidStateTransition(DNSJobStatus.PENDING, DNSJobStatus.FAILED)).toBe(true);
    });

    it('should allow QUEUED → WIRING_MX', () => {
      expect(isValidStateTransition(DNSJobStatus.QUEUED, DNSJobStatus.WIRING_MX)).toBe(true);
    });

    it('should allow QUEUED → VERIFYING (skip wiring)', () => {
      expect(isValidStateTransition(DNSJobStatus.QUEUED, DNSJobStatus.VERIFYING)).toBe(true);
    });

    it('should allow WIRING_MX → WIRING_SPF', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_MX, DNSJobStatus.WIRING_SPF)).toBe(true);
    });

    it('should allow WIRING_SPF → WIRING_DKIM', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_SPF, DNSJobStatus.WIRING_DKIM)).toBe(true);
    });

    it('should allow WIRING_SPF → WIRING_DMARC (skip DKIM)', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_SPF, DNSJobStatus.WIRING_DMARC)).toBe(true);
    });

    it('should allow WIRING_DKIM → WIRING_DMARC', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_DKIM, DNSJobStatus.WIRING_DMARC)).toBe(true);
    });

    it('should allow WIRING_DMARC → WIRING_CNAME', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_DMARC, DNSJobStatus.WIRING_CNAME)).toBe(true);
    });

    it('should allow WIRING_DMARC → WIRING_COMPLETE (skip CNAME)', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_DMARC, DNSJobStatus.WIRING_COMPLETE)).toBe(true);
    });

    it('should allow WIRING_CNAME → WIRING_COMPLETE', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_CNAME, DNSJobStatus.WIRING_COMPLETE)).toBe(true);
    });

    it('should allow WIRING_COMPLETE → VERIFYING', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_COMPLETE, DNSJobStatus.VERIFYING)).toBe(true);
    });

    it('should allow WIRING_COMPLETE → COMPLETE (skip verification)', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_COMPLETE, DNSJobStatus.COMPLETE)).toBe(true);
    });

    it('should allow VERIFYING → COMPLETE', () => {
      expect(isValidStateTransition(DNSJobStatus.VERIFYING, DNSJobStatus.COMPLETE)).toBe(true);
    });

    it('should allow any non-terminal → FAILED', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_MX, DNSJobStatus.FAILED)).toBe(true);
      expect(isValidStateTransition(DNSJobStatus.WIRING_SPF, DNSJobStatus.FAILED)).toBe(true);
      expect(isValidStateTransition(DNSJobStatus.VERIFYING, DNSJobStatus.FAILED)).toBe(true);
    });

    it('should not allow PENDING → WIRING_MX (must go through QUEUED)', () => {
      expect(isValidStateTransition(DNSJobStatus.PENDING, DNSJobStatus.WIRING_MX)).toBe(false);
    });

    it('should not allow COMPLETE → any state', () => {
      expect(isValidStateTransition(DNSJobStatus.COMPLETE, DNSJobStatus.PENDING)).toBe(false);
      expect(isValidStateTransition(DNSJobStatus.COMPLETE, DNSJobStatus.FAILED)).toBe(false);
    });

    it('should not allow FAILED → any state', () => {
      expect(isValidStateTransition(DNSJobStatus.FAILED, DNSJobStatus.PENDING)).toBe(false);
      expect(isValidStateTransition(DNSJobStatus.FAILED, DNSJobStatus.QUEUED)).toBe(false);
    });

    it('should not allow backward transitions', () => {
      expect(isValidStateTransition(DNSJobStatus.WIRING_SPF, DNSJobStatus.WIRING_MX)).toBe(false);
      expect(isValidStateTransition(DNSJobStatus.WIRING_DMARC, DNSJobStatus.WIRING_SPF)).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it('should recognize COMPLETE as terminal', () => {
      expect(isTerminalState(DNSJobStatus.COMPLETE)).toBe(true);
    });

    it('should recognize FAILED as terminal', () => {
      expect(isTerminalState(DNSJobStatus.FAILED)).toBe(true);
    });

    it('should not recognize non-terminal states', () => {
      expect(isTerminalState(DNSJobStatus.PENDING)).toBe(false);
      expect(isTerminalState(DNSJobStatus.QUEUED)).toBe(false);
      expect(isTerminalState(DNSJobStatus.WIRING_MX)).toBe(false);
      expect(isTerminalState(DNSJobStatus.WIRING_SPF)).toBe(false);
      expect(isTerminalState(DNSJobStatus.VERIFYING)).toBe(false);
    });
  });

  describe('isRetryableState', () => {
    it('should mark FAILED as retryable', () => {
      expect(isRetryableState(DNSJobStatus.FAILED)).toBe(true);
    });

    it('should not mark COMPLETE as retryable', () => {
      expect(isRetryableState(DNSJobStatus.COMPLETE)).toBe(false);
    });

    it('should not mark in-progress states as retryable', () => {
      expect(isRetryableState(DNSJobStatus.PENDING)).toBe(false);
      expect(isRetryableState(DNSJobStatus.QUEUED)).toBe(false);
      expect(isRetryableState(DNSJobStatus.WIRING_MX)).toBe(false);
      expect(isRetryableState(DNSJobStatus.WIRING_SPF)).toBe(false);
    });
  });
});

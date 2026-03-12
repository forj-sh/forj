/**
 * Unit tests for Cloudflare worker state machine
 */

import { describe, it, expect } from '@jest/globals';
import {
  CloudflareJobStatus,
  isValidStateTransition,
  isTerminalState,
  isRetryableState,
} from '../cloudflare-worker.js';

describe('Cloudflare Worker State Machine', () => {
  describe('isValidStateTransition', () => {
    it('should allow PENDING → QUEUED', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.PENDING, CloudflareJobStatus.QUEUED)
      ).toBe(true);
    });

    it('should allow PENDING → FAILED', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.PENDING, CloudflareJobStatus.FAILED)
      ).toBe(true);
    });

    it('should allow QUEUED → CREATING_ZONE', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.QUEUED, CloudflareJobStatus.CREATING_ZONE)
      ).toBe(true);
    });

    it('should allow CREATING_ZONE → ZONE_CREATED', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.CREATING_ZONE, CloudflareJobStatus.ZONE_CREATED)
      ).toBe(true);
    });

    it('should allow ZONE_CREATED → UPDATING_NAMESERVERS', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.ZONE_CREATED, CloudflareJobStatus.UPDATING_NAMESERVERS)
      ).toBe(true);
    });

    it('should allow ZONE_CREATED → COMPLETE (skip NS update)', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.ZONE_CREATED, CloudflareJobStatus.COMPLETE)
      ).toBe(true);
    });

    it('should allow UPDATING_NAMESERVERS → NAMESERVERS_UPDATED', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.UPDATING_NAMESERVERS, CloudflareJobStatus.NAMESERVERS_UPDATED)
      ).toBe(true);
    });

    it('should allow NAMESERVERS_UPDATED → VERIFYING_NAMESERVERS', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.NAMESERVERS_UPDATED, CloudflareJobStatus.VERIFYING_NAMESERVERS)
      ).toBe(true);
    });

    it('should allow NAMESERVERS_UPDATED → COMPLETE (skip verification)', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.NAMESERVERS_UPDATED, CloudflareJobStatus.COMPLETE)
      ).toBe(true);
    });

    it('should allow VERIFYING_NAMESERVERS → COMPLETE', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.VERIFYING_NAMESERVERS, CloudflareJobStatus.COMPLETE)
      ).toBe(true);
    });

    it('should allow any non-terminal → FAILED', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.CREATING_ZONE, CloudflareJobStatus.FAILED)
      ).toBe(true);
      expect(
        isValidStateTransition(CloudflareJobStatus.UPDATING_NAMESERVERS, CloudflareJobStatus.FAILED)
      ).toBe(true);
      expect(
        isValidStateTransition(CloudflareJobStatus.VERIFYING_NAMESERVERS, CloudflareJobStatus.FAILED)
      ).toBe(true);
    });

    it('should not allow PENDING → CREATING_ZONE (must go through QUEUED)', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.PENDING, CloudflareJobStatus.CREATING_ZONE)
      ).toBe(false);
    });

    it('should not allow COMPLETE → any state', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.COMPLETE, CloudflareJobStatus.PENDING)
      ).toBe(false);
      expect(
        isValidStateTransition(CloudflareJobStatus.COMPLETE, CloudflareJobStatus.FAILED)
      ).toBe(false);
    });

    it('should not allow FAILED → any state', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.FAILED, CloudflareJobStatus.PENDING)
      ).toBe(false);
      expect(
        isValidStateTransition(CloudflareJobStatus.FAILED, CloudflareJobStatus.QUEUED)
      ).toBe(false);
    });

    it('should not allow backward transitions', () => {
      expect(
        isValidStateTransition(CloudflareJobStatus.ZONE_CREATED, CloudflareJobStatus.CREATING_ZONE)
      ).toBe(false);
      expect(
        isValidStateTransition(CloudflareJobStatus.NAMESERVERS_UPDATED, CloudflareJobStatus.UPDATING_NAMESERVERS)
      ).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it('should recognize COMPLETE as terminal', () => {
      expect(isTerminalState(CloudflareJobStatus.COMPLETE)).toBe(true);
    });

    it('should recognize FAILED as terminal', () => {
      expect(isTerminalState(CloudflareJobStatus.FAILED)).toBe(true);
    });

    it('should not recognize non-terminal states', () => {
      expect(isTerminalState(CloudflareJobStatus.PENDING)).toBe(false);
      expect(isTerminalState(CloudflareJobStatus.QUEUED)).toBe(false);
      expect(isTerminalState(CloudflareJobStatus.CREATING_ZONE)).toBe(false);
      expect(isTerminalState(CloudflareJobStatus.UPDATING_NAMESERVERS)).toBe(false);
      expect(isTerminalState(CloudflareJobStatus.VERIFYING_NAMESERVERS)).toBe(false);
    });
  });

  describe('isRetryableState', () => {
    it('should mark FAILED as retryable', () => {
      expect(isRetryableState(CloudflareJobStatus.FAILED)).toBe(true);
    });

    it('should not mark COMPLETE as retryable', () => {
      expect(isRetryableState(CloudflareJobStatus.COMPLETE)).toBe(false);
    });

    it('should not mark in-progress states as retryable', () => {
      expect(isRetryableState(CloudflareJobStatus.PENDING)).toBe(false);
      expect(isRetryableState(CloudflareJobStatus.QUEUED)).toBe(false);
      expect(isRetryableState(CloudflareJobStatus.CREATING_ZONE)).toBe(false);
      expect(isRetryableState(CloudflareJobStatus.UPDATING_NAMESERVERS)).toBe(false);
    });
  });
});

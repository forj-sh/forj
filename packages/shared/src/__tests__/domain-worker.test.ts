/**
 * Unit tests for domain worker state machine
 */

import { describe, it, expect } from '@jest/globals';
import {
  DomainJobStatus,
  DomainOperationType,
  DOMAIN_STATE_TRANSITIONS,
  isValidStateTransition,
  isTerminalState,
  isRetryableState,
  type DomainWorkerEvent,
  DomainWorkerEventType,
} from '../domain-worker.js';

describe('Domain Worker State Machine', () => {
  describe('DOMAIN_STATE_TRANSITIONS', () => {
    it('should define transitions for all states', () => {
      const allStates = Object.values(DomainJobStatus);

      for (const state of allStates) {
        expect(DOMAIN_STATE_TRANSITIONS[state]).toBeDefined();
        expect(Array.isArray(DOMAIN_STATE_TRANSITIONS[state])).toBe(true);
      }
    });

    it('should allow CHECKING to transition to COMPLETE', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.CHECKING];
      expect(transitions).toContain(DomainJobStatus.COMPLETE);
    });

    it('should make UNAVAILABLE a terminal state', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.UNAVAILABLE];
      expect(transitions).toEqual([]);
    });

    it('should allow FAILED to transition to RETRYING', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.FAILED];
      expect(transitions).toContain(DomainJobStatus.RETRYING);
    });

    it('should allow CHECKING to transition to RETRYING', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.CHECKING];
      expect(transitions).toContain(DomainJobStatus.RETRYING);
    });

    it('should allow REGISTERING to transition to RETRYING', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.REGISTERING];
      expect(transitions).toContain(DomainJobStatus.RETRYING);
    });

    it('should allow CONFIGURING to transition to RETRYING', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.CONFIGURING];
      expect(transitions).toContain(DomainJobStatus.RETRYING);
    });

    it('should make COMPLETE a terminal state', () => {
      const transitions = DOMAIN_STATE_TRANSITIONS[DomainJobStatus.COMPLETE];
      expect(transitions).toEqual([]);
    });
  });

  describe('isValidStateTransition', () => {
    it('should return true for valid transitions', () => {
      expect(isValidStateTransition(DomainJobStatus.PENDING, DomainJobStatus.QUEUED)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.QUEUED, DomainJobStatus.CHECKING)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.AVAILABLE)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.COMPLETE)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.AVAILABLE, DomainJobStatus.REGISTERING)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.REGISTERING, DomainJobStatus.CONFIGURING)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.CONFIGURING, DomainJobStatus.COMPLETE)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.FAILED, DomainJobStatus.RETRYING)).toBe(true);
      expect(isValidStateTransition(DomainJobStatus.RETRYING, DomainJobStatus.QUEUED)).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(isValidStateTransition(DomainJobStatus.PENDING, DomainJobStatus.REGISTERING)).toBe(false);
      expect(isValidStateTransition(DomainJobStatus.COMPLETE, DomainJobStatus.CHECKING)).toBe(false);
      expect(isValidStateTransition(DomainJobStatus.COMPLETE, DomainJobStatus.FAILED)).toBe(false);
      expect(isValidStateTransition(DomainJobStatus.UNAVAILABLE, DomainJobStatus.REGISTERING)).toBe(false);
      expect(isValidStateTransition(DomainJobStatus.UNAVAILABLE, DomainJobStatus.FAILED)).toBe(false);
    });

    it('should allow transitions to RETRYING from CHECKING', () => {
      expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.RETRYING)).toBe(true);
    });

    it('should allow transitions to RETRYING from REGISTERING', () => {
      expect(isValidStateTransition(DomainJobStatus.REGISTERING, DomainJobStatus.RETRYING)).toBe(true);
    });

    it('should allow transitions to RETRYING from CONFIGURING', () => {
      expect(isValidStateTransition(DomainJobStatus.CONFIGURING, DomainJobStatus.RETRYING)).toBe(true);
    });
  });

  describe('isTerminalState', () => {
    it('should return true for COMPLETE', () => {
      expect(isTerminalState(DomainJobStatus.COMPLETE)).toBe(true);
    });

    it('should return true for UNAVAILABLE', () => {
      expect(isTerminalState(DomainJobStatus.UNAVAILABLE)).toBe(true);
    });

    it('should return false for FAILED (can transition to RETRYING)', () => {
      expect(isTerminalState(DomainJobStatus.FAILED)).toBe(false);
    });

    it('should return false for intermediate states', () => {
      expect(isTerminalState(DomainJobStatus.PENDING)).toBe(false);
      expect(isTerminalState(DomainJobStatus.QUEUED)).toBe(false);
      expect(isTerminalState(DomainJobStatus.CHECKING)).toBe(false);
      expect(isTerminalState(DomainJobStatus.AVAILABLE)).toBe(false);
      expect(isTerminalState(DomainJobStatus.REGISTERING)).toBe(false);
      expect(isTerminalState(DomainJobStatus.CONFIGURING)).toBe(false);
      expect(isTerminalState(DomainJobStatus.RETRYING)).toBe(false);
    });

    it('should derive terminal states from transition map', () => {
      // Any state with no valid transitions is terminal
      const allStates = Object.values(DomainJobStatus);

      for (const state of allStates) {
        const transitions = DOMAIN_STATE_TRANSITIONS[state];
        const hasNoTransitions = transitions.length === 0;

        expect(isTerminalState(state)).toBe(hasNoTransitions);
      }
    });
  });

  describe('isRetryableState', () => {
    it('should return true for FAILED', () => {
      expect(isRetryableState(DomainJobStatus.FAILED)).toBe(true);
    });

    it('should return true for CHECKING', () => {
      expect(isRetryableState(DomainJobStatus.CHECKING)).toBe(true);
    });

    it('should return true for REGISTERING', () => {
      expect(isRetryableState(DomainJobStatus.REGISTERING)).toBe(true);
    });

    it('should return true for CONFIGURING', () => {
      expect(isRetryableState(DomainJobStatus.CONFIGURING)).toBe(true);
    });

    it('should return false for terminal states', () => {
      expect(isRetryableState(DomainJobStatus.COMPLETE)).toBe(false);
      expect(isRetryableState(DomainJobStatus.UNAVAILABLE)).toBe(false);
    });

    it('should return false for non-retryable intermediate states', () => {
      expect(isRetryableState(DomainJobStatus.PENDING)).toBe(false);
      expect(isRetryableState(DomainJobStatus.QUEUED)).toBe(false);
      expect(isRetryableState(DomainJobStatus.AVAILABLE)).toBe(false);
      expect(isRetryableState(DomainJobStatus.RETRYING)).toBe(false);
    });

    it('should match states that can transition to RETRYING', () => {
      const allStates = Object.values(DomainJobStatus);

      for (const state of allStates) {
        const canTransitionToRetrying = DOMAIN_STATE_TRANSITIONS[state].includes(DomainJobStatus.RETRYING);
        const isRetryable = isRetryableState(state);

        if (canTransitionToRetrying) {
          expect(isRetryable).toBe(true);
        }
      }
    });
  });

  describe('State Machine Flows', () => {
    describe('CHECK operation flow', () => {
      it('should support check-only flow: PENDING -> QUEUED -> CHECKING -> COMPLETE', () => {
        expect(isValidStateTransition(DomainJobStatus.PENDING, DomainJobStatus.QUEUED)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.QUEUED, DomainJobStatus.CHECKING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.COMPLETE)).toBe(true);
        expect(isTerminalState(DomainJobStatus.COMPLETE)).toBe(true);
      });

      it('should support check with unavailable result: CHECKING -> UNAVAILABLE', () => {
        expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.UNAVAILABLE)).toBe(true);
        expect(isTerminalState(DomainJobStatus.UNAVAILABLE)).toBe(true);
      });

      it('should support check with retry: CHECKING -> RETRYING -> CHECKING', () => {
        expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.RETRYING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.RETRYING, DomainJobStatus.CHECKING)).toBe(true);
      });
    });

    describe('REGISTER operation flow', () => {
      it('should support full registration: PENDING -> QUEUED -> CHECKING -> AVAILABLE -> REGISTERING -> CONFIGURING -> COMPLETE', () => {
        expect(isValidStateTransition(DomainJobStatus.PENDING, DomainJobStatus.QUEUED)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.QUEUED, DomainJobStatus.CHECKING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.CHECKING, DomainJobStatus.AVAILABLE)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.AVAILABLE, DomainJobStatus.REGISTERING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.REGISTERING, DomainJobStatus.CONFIGURING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.CONFIGURING, DomainJobStatus.COMPLETE)).toBe(true);
        expect(isTerminalState(DomainJobStatus.COMPLETE)).toBe(true);
      });

      it('should support registration without nameserver config: REGISTERING -> COMPLETE', () => {
        expect(isValidStateTransition(DomainJobStatus.REGISTERING, DomainJobStatus.COMPLETE)).toBe(true);
      });

      it('should support registration failure and retry: REGISTERING -> RETRYING -> REGISTERING', () => {
        expect(isValidStateTransition(DomainJobStatus.REGISTERING, DomainJobStatus.RETRYING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.RETRYING, DomainJobStatus.REGISTERING)).toBe(true);
      });
    });

    describe('SET_NAMESERVERS operation flow', () => {
      it('should support direct configuration: PENDING -> QUEUED -> CONFIGURING -> COMPLETE', () => {
        expect(isValidStateTransition(DomainJobStatus.PENDING, DomainJobStatus.QUEUED)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.QUEUED, DomainJobStatus.CONFIGURING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.CONFIGURING, DomainJobStatus.COMPLETE)).toBe(true);
      });

      it('should support configuration retry: CONFIGURING -> RETRYING -> CONFIGURING', () => {
        expect(isValidStateTransition(DomainJobStatus.CONFIGURING, DomainJobStatus.RETRYING)).toBe(true);
        expect(isValidStateTransition(DomainJobStatus.RETRYING, DomainJobStatus.CONFIGURING)).toBe(true);
      });
    });

    describe('Retry flows', () => {
      it('should allow retry to return to QUEUED', () => {
        expect(isValidStateTransition(DomainJobStatus.RETRYING, DomainJobStatus.QUEUED)).toBe(true);
      });

      it('should allow retry to FAILED after max attempts', () => {
        expect(isValidStateTransition(DomainJobStatus.RETRYING, DomainJobStatus.FAILED)).toBe(true);
      });

      it('should not allow terminal states to retry', () => {
        expect(isRetryableState(DomainJobStatus.COMPLETE)).toBe(false);
        expect(isRetryableState(DomainJobStatus.UNAVAILABLE)).toBe(false);
      });
    });
  });

  describe('DomainWorkerEvent', () => {
    it('should have unknown type for data field', () => {
      const event: DomainWorkerEvent = {
        type: DomainWorkerEventType.JOB_CREATED,
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.CHECK,
        status: DomainJobStatus.PENDING,
        timestamp: Date.now(),
      };

      // This should compile - data is optional
      expect(event.data).toBeUndefined();
    });

    it('should accept unknown data', () => {
      const event: DomainWorkerEvent = {
        type: DomainWorkerEventType.JOB_PROGRESS,
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.REGISTERING,
        timestamp: Date.now(),
        data: { progress: 50 },
      };

      // Data is unknown, so we need to type guard before using
      expect(event.data).toBeDefined();

      if (typeof event.data === 'object' && event.data !== null && 'progress' in event.data) {
        expect((event.data as { progress: number }).progress).toBe(50);
      }
    });

    it('should include error field for failure events', () => {
      const event: DomainWorkerEvent = {
        type: DomainWorkerEventType.JOB_FAILED,
        jobId: 'job-123',
        projectId: 'proj-456',
        operation: DomainOperationType.REGISTER,
        status: DomainJobStatus.FAILED,
        timestamp: Date.now(),
        error: 'Domain registration failed',
      };

      expect(event.error).toBe('Domain registration failed');
    });
  });

  describe('Edge cases and validation', () => {
    it('should not allow transitions from terminal states', () => {
      const terminalStates = [DomainJobStatus.COMPLETE, DomainJobStatus.UNAVAILABLE];
      const allStates = Object.values(DomainJobStatus);

      for (const terminalState of terminalStates) {
        for (const targetState of allStates) {
          if (terminalState === targetState) continue;
          expect(isValidStateTransition(terminalState, targetState)).toBe(false);
        }
      }
    });

    it('should validate all transition map entries are valid states', () => {
      const allStates = new Set(Object.values(DomainJobStatus));

      for (const [fromState, transitions] of Object.entries(DOMAIN_STATE_TRANSITIONS)) {
        // Verify the key is a valid state
        expect(allStates.has(fromState as DomainJobStatus)).toBe(true);

        // Verify all transition targets are valid states
        for (const toState of transitions) {
          expect(allStates.has(toState)).toBe(true);
        }
      }
    });

    it('should prevent cycles in terminal states', () => {
      const terminalStates = [DomainJobStatus.COMPLETE, DomainJobStatus.UNAVAILABLE];

      for (const state of terminalStates) {
        const transitions = DOMAIN_STATE_TRANSITIONS[state];
        expect(transitions).toEqual([]);
        expect(transitions).not.toContain(state); // No self-loops
      }
    });
  });
});

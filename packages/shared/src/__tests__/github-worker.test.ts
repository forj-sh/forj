/**
 * Unit tests for GitHub worker state machine
 */

import { describe, it, expect } from '@jest/globals';
import {
  GitHubJobStatus,
  isValidStateTransition,
  isTerminalState,
  isRetryableState,
} from '../github-worker.js';

describe('GitHub Worker State Machine', () => {
  describe('isValidStateTransition', () => {
    it('should allow PENDING → QUEUED', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.PENDING, GitHubJobStatus.QUEUED)
      ).toBe(true);
    });

    it('should allow PENDING → FAILED', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.PENDING, GitHubJobStatus.FAILED)
      ).toBe(true);
    });

    it('should allow QUEUED → VERIFYING_ORG', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.QUEUED, GitHubJobStatus.VERIFYING_ORG)
      ).toBe(true);
    });

    it('should allow VERIFYING_ORG → ORG_VERIFIED', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.VERIFYING_ORG, GitHubJobStatus.ORG_VERIFIED)
      ).toBe(true);
    });

    it('should allow ORG_VERIFIED → CREATING_REPO', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.ORG_VERIFIED, GitHubJobStatus.CREATING_REPO)
      ).toBe(true);
    });

    it('should allow ORG_VERIFIED → COMPLETE (skip repo creation)', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.ORG_VERIFIED, GitHubJobStatus.COMPLETE)
      ).toBe(true);
    });

    it('should allow CREATING_REPO → REPO_CREATED', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.CREATING_REPO, GitHubJobStatus.REPO_CREATED)
      ).toBe(true);
    });

    it('should allow REPO_CREATED → CONFIGURING', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.REPO_CREATED, GitHubJobStatus.CONFIGURING)
      ).toBe(true);
    });

    it('should allow REPO_CREATED → COMPLETE (skip configuration)', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.REPO_CREATED, GitHubJobStatus.COMPLETE)
      ).toBe(true);
    });

    it('should allow CONFIGURING → COMPLETE', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.CONFIGURING, GitHubJobStatus.COMPLETE)
      ).toBe(true);
    });

    it('should allow any non-terminal → FAILED', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.VERIFYING_ORG, GitHubJobStatus.FAILED)
      ).toBe(true);
      expect(
        isValidStateTransition(GitHubJobStatus.CREATING_REPO, GitHubJobStatus.FAILED)
      ).toBe(true);
      expect(
        isValidStateTransition(GitHubJobStatus.CONFIGURING, GitHubJobStatus.FAILED)
      ).toBe(true);
    });

    it('should not allow PENDING → VERIFYING_ORG (must go through QUEUED)', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.PENDING, GitHubJobStatus.VERIFYING_ORG)
      ).toBe(false);
    });

    it('should not allow COMPLETE → any state', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.COMPLETE, GitHubJobStatus.PENDING)
      ).toBe(false);
      expect(
        isValidStateTransition(GitHubJobStatus.COMPLETE, GitHubJobStatus.FAILED)
      ).toBe(false);
    });

    it('should not allow FAILED → any state', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.FAILED, GitHubJobStatus.PENDING)
      ).toBe(false);
      expect(
        isValidStateTransition(GitHubJobStatus.FAILED, GitHubJobStatus.QUEUED)
      ).toBe(false);
    });

    it('should not allow backward transitions', () => {
      expect(
        isValidStateTransition(GitHubJobStatus.REPO_CREATED, GitHubJobStatus.CREATING_REPO)
      ).toBe(false);
      expect(
        isValidStateTransition(GitHubJobStatus.ORG_VERIFIED, GitHubJobStatus.VERIFYING_ORG)
      ).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it('should recognize COMPLETE as terminal', () => {
      expect(isTerminalState(GitHubJobStatus.COMPLETE)).toBe(true);
    });

    it('should recognize FAILED as terminal', () => {
      expect(isTerminalState(GitHubJobStatus.FAILED)).toBe(true);
    });

    it('should not recognize non-terminal states', () => {
      expect(isTerminalState(GitHubJobStatus.PENDING)).toBe(false);
      expect(isTerminalState(GitHubJobStatus.QUEUED)).toBe(false);
      expect(isTerminalState(GitHubJobStatus.VERIFYING_ORG)).toBe(false);
      expect(isTerminalState(GitHubJobStatus.CREATING_REPO)).toBe(false);
      expect(isTerminalState(GitHubJobStatus.CONFIGURING)).toBe(false);
    });
  });

  describe('isRetryableState', () => {
    it('should mark FAILED as retryable', () => {
      expect(isRetryableState(GitHubJobStatus.FAILED)).toBe(true);
    });

    it('should not mark COMPLETE as retryable', () => {
      expect(isRetryableState(GitHubJobStatus.COMPLETE)).toBe(false);
    });

    it('should not mark in-progress states as retryable', () => {
      expect(isRetryableState(GitHubJobStatus.PENDING)).toBe(false);
      expect(isRetryableState(GitHubJobStatus.QUEUED)).toBe(false);
      expect(isRetryableState(GitHubJobStatus.VERIFYING_ORG)).toBe(false);
      expect(isRetryableState(GitHubJobStatus.CREATING_REPO)).toBe(false);
    });
  });
});

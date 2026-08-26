import { describe, it, expect } from 'vitest';
import { FreshnessEngine } from '../src/engine.js';
import type { EvidenceValidityContext, TestCaseExecutionDecision } from '../src/models.js';

describe('FreshnessEngine', () => {
  const engine = new FreshnessEngine();

  describe('evaluateTestCase', () => {
    it('should return retest for new TestCase', () => {
      const decision = engine.evaluateTestCase(
        'tc-1',
        undefined,
        { testCaseId: 'tc-1' },
      );

      expect(decision.decision).toBe('retest');
      expect(decision.reasons).toContain('new-testcase');
    });

    it('should return safe-reuse when all dimensions match', () => {
      const previousContext: EvidenceValidityContext = {
        schemaVersion: '1.0',
        evidenceId: 'ev-1',
        testCaseId: 'tc-1',
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
        acquiredAt: '2026-01-01T00:00:00Z',
        reusePolicyVersion: '1.0',
      };

      const currentContext: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      expect(decision.decision).toBe('safe-reuse');
      expect(decision.reasons).toHaveLength(0);
    });

    it('should return invalidated when application changes', () => {
      const previousContext: EvidenceValidityContext = {
        schemaVersion: '1.0',
        evidenceId: 'ev-1',
        testCaseId: 'tc-1',
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
        acquiredAt: '2026-01-01T00:00:00Z',
        reusePolicyVersion: '1.0',
      };

      const currentContext: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-2' }, // Changed
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      expect(decision.decision).toBe('invalidated');
      expect(decision.reasons).toContain('application-changed');
    });

    it('should return invalidated when environment changes', () => {
      const previousContext: EvidenceValidityContext = {
        schemaVersion: '1.0',
        evidenceId: 'ev-1',
        testCaseId: 'tc-1',
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
        acquiredAt: '2026-01-01T00:00:00Z',
        reusePolicyVersion: '1.0',
      };

      const currentContext: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-2', fingerprint: 'env-2' }, // Changed
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      expect(decision.decision).toBe('invalidated');
      expect(decision.reasons).toContain('environment-changed');
    });

    it('should return unknown-retest when application identity is unknown', () => {
      const previousContext: EvidenceValidityContext = {
        schemaVersion: '1.0',
        evidenceId: 'ev-1',
        testCaseId: 'tc-1',
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        // No application identity
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
        acquiredAt: '2026-01-01T00:00:00Z',
        reusePolicyVersion: '1.0',
      };

      const currentContext: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-1',
        testCaseContentHash: 'tc-hash-1',
        expectedResultContentHash: 'er-hash-1',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      expect(decision.decision).toBe('unknown-retest');
      expect(decision.reasons).toContain('unknown-freshness');
    });
  });

  describe('createExecutionPlan', () => {
    it('should create execution plan from decisions', () => {
      const decisions: TestCaseExecutionDecision[] = [
        {
          testCaseId: 'tc-1',
          decision: 'retest',
          reasons: ['requirement-changed'],
          freshnessMatches: {
            spec: 'mismatch',
            requirement: 'mismatch',
            testcase: 'match',
            'expected-result': 'match',
            application: 'match',
            environment: 'match',
            data: 'not-applicable',
            'verification-policy': 'not-applicable',
            capability: 'not-applicable',
            time: 'not-applicable',
          },
        },
        {
          testCaseId: 'tc-2',
          decision: 'safe-reuse',
          reasons: [],
          freshnessMatches: {
            spec: 'match',
            requirement: 'match',
            testcase: 'match',
            'expected-result': 'match',
            application: 'match',
            environment: 'match',
            data: 'not-applicable',
            'verification-policy': 'not-applicable',
            capability: 'not-applicable',
            time: 'not-applicable',
          },
        },
      ];

      const plan = engine.createExecutionPlan(decisions, 'rev-1', 'rev-1');

      expect(plan.toExecute).toHaveLength(1);
      expect(plan.toReuse).toHaveLength(1);
      expect(plan.summary.testCasesTotal).toBe(2);
      expect(plan.summary.testCasesExecuted).toBe(1);
      expect(plan.summary.testCasesReused).toBe(1);
    });
  });
});

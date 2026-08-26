import { describe, it, expect } from 'vitest';
import { FreshnessEngine } from '../src/engine.js';
import type { EvidenceValidityContext, TestCaseExecutionDecision } from '../src/models.js';

describe('Phase 4B.3 Deterministic Acceptance', () => {
  const engine = new FreshnessEngine();

  describe('Section 40: No-Change Case', () => {
    it('should reuse all evidence when no changes', () => {
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

    it('should execute 0 TestCases when no changes', () => {
      const decisions: TestCaseExecutionDecision[] = [
        {
          testCaseId: 'tc-1',
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

      expect(plan.toExecute).toHaveLength(0);
      expect(plan.toReuse).toHaveLength(1);
      expect(plan.summary.testCasesExecuted).toBe(0);
      expect(plan.summary.testCasesReused).toBe(1);
    });
  });

  describe('Section 41: Spec-Local Change Case', () => {
    it('should retest impacted TestCase and reuse unaffected', () => {
      const previousContext1: EvidenceValidityContext = {
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

      const previousContext2: EvidenceValidityContext = {
        schemaVersion: '1.0',
        evidenceId: 'ev-2',
        testCaseId: 'tc-2',
        sourceRevisionFingerprint: 'rev-1',
        requirementContentHash: 'req-hash-2',
        testCaseContentHash: 'tc-hash-2',
        expectedResultContentHash: 'er-hash-2',
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
        acquiredAt: '2026-01-01T00:00:00Z',
        reusePolicyVersion: '1.0',
      };

      // R1 changed, R2 unchanged
      const currentContext1: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-2',
        requirementContentHash: 'req-hash-1-new', // Changed
        testCaseContentHash: 'tc-hash-1-new', // Changed
        expectedResultContentHash: 'er-hash-1-new', // Changed
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const currentContext2: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1', // Same as previous (R2 unchanged)
        requirementContentHash: 'req-hash-2', // Unchanged
        testCaseContentHash: 'tc-hash-2', // Unchanged
        expectedResultContentHash: 'er-hash-2', // Unchanged
        application: { fingerprint: 'app-1' },
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const decision1 = engine.evaluateTestCase('tc-1', previousContext1, currentContext1);
      const decision2 = engine.evaluateTestCase('tc-2', previousContext2, currentContext2);

      // R1 should be invalidated (evidence is stale)
      expect(decision1.decision).toBe('invalidated');
      expect(decision1.reasons).toContain('requirement-changed');

      // R2 should be reused
      expect(decision2.decision).toBe('safe-reuse');
      expect(decision2.reasons).toHaveLength(0);
    });
  });

  describe('Section 42: Application Change Case', () => {
    it('should retest all evidence when application changes', () => {
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

      // Spec unchanged, application changed
      const currentContext: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1', // Same spec
        requirementContentHash: 'req-hash-1', // Same
        testCaseContentHash: 'tc-hash-1', // Same
        expectedResultContentHash: 'er-hash-1', // Same
        application: { fingerprint: 'app-2' }, // Changed
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      expect(decision.decision).toBe('invalidated');
      expect(decision.reasons).toContain('application-changed');
    });
  });

  describe('Section 43: Unknown Application Identity Case', () => {
    it('should retest when application identity is unknown', () => {
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

  describe('Section 44: Environment Change Case', () => {
    it('should retest when environment changes', () => {
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
  });

  describe('Section 47: Verification Change Case', () => {
    it('should retest when verification policy changes', () => {
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
        verificationPolicy: { verificationIntent: 'ui-visible', fingerprint: 'vp-1' },
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
        verificationPolicy: { verificationIntent: 'persisted-state', fingerprint: 'vp-2' }, // Changed
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      expect(decision.decision).toBe('invalidated');
      expect(decision.reasons).toContain('verification-changed');
    });
  });

  describe('Section 53: Stale Reuse Prevention', () => {
    it('should deny reuse when spec unchanged but application changed', () => {
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

      // Spec unchanged, application changed
      const currentContext: Partial<EvidenceValidityContext> = {
        sourceRevisionFingerprint: 'rev-1', // Same spec
        requirementContentHash: 'req-hash-1', // Same
        testCaseContentHash: 'tc-hash-1', // Same
        expectedResultContentHash: 'er-hash-1', // Same
        application: { fingerprint: 'app-2' }, // Changed
        environment: { environmentId: 'env-1', fingerprint: 'env-1' },
      };

      const decision = engine.evaluateTestCase('tc-1', previousContext, currentContext);

      // Reuse should be denied
      expect(decision.decision).not.toBe('safe-reuse');
      expect(decision.decision).toBe('invalidated');
    });
  });

  describe('Section 54: Unknown Freshness Prevention', () => {
    it('should deny reuse when any required dimension is unknown', () => {
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

      // Reuse should be denied
      expect(decision.decision).not.toBe('safe-reuse');
      expect(decision.decision).toBe('unknown-retest');
    });
  });
});

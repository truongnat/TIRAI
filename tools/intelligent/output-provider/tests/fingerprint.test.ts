import { describe, it, expect } from 'vitest';
import { sha256, computeDeliveryKey, computePayloadFingerprint, computeOutputId } from '../src/fingerprint.js';
import { CanonicalOutputPayload } from '../src/models.js';

describe('fingerprint', () => {
  describe('sha256', () => {
    it('computes deterministic hash', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('world');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 16 character hex string', () => {
      const hash = sha256('test');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('computeDeliveryKey', () => {
    it('computes deterministic delivery key', () => {
      const key1 = computeDeliveryKey({
        providerId: 'local-report',
        targetIdentity: '/output/report',
        runId: 'run_001',
      });

      const key2 = computeDeliveryKey({
        providerId: 'local-report',
        targetIdentity: '/output/report',
        runId: 'run_001',
      });

      expect(key1).toBe(key2);
    });

    it('produces different keys for different providers', () => {
      const key1 = computeDeliveryKey({
        providerId: 'provider-a',
        targetIdentity: '/output/report',
        runId: 'run_001',
      });

      const key2 = computeDeliveryKey({
        providerId: 'provider-b',
        targetIdentity: '/output/report',
        runId: 'run_001',
      });

      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different targets', () => {
      const key1 = computeDeliveryKey({
        providerId: 'local-report',
        targetIdentity: '/output/report-a',
        runId: 'run_001',
      });

      const key2 = computeDeliveryKey({
        providerId: 'local-report',
        targetIdentity: '/output/report-b',
        runId: 'run_001',
      });

      expect(key1).not.toBe(key2);
    });
  });

  describe('computePayloadFingerprint', () => {
    it('computes deterministic fingerprint', () => {
      const payload = makeTestPayload();

      const fp1 = computePayloadFingerprint(payload);
      const fp2 = computePayloadFingerprint(payload);

      expect(fp1).toBe(fp2);
    });

    it('produces different fingerprints for different content', () => {
      const payload1 = makeTestPayload();
      const payload2 = makeTestPayload();
      payload2.testCases[0].status = 'FAIL';

      const fp1 = computePayloadFingerprint(payload1);
      const fp2 = computePayloadFingerprint(payload2);

      expect(fp1).not.toBe(fp2);
    });

    it('is order-independent for requirements', () => {
      const payload1 = makeTestPayload();
      payload1.requirements = [
        { requirementId: 'R1', status: 'PASS', testCaseIds: [], evidenceIds: [] },
        { requirementId: 'R2', status: 'FAIL', testCaseIds: [], evidenceIds: [] },
      ];

      const payload2 = makeTestPayload();
      payload2.requirements = [
        { requirementId: 'R2', status: 'FAIL', testCaseIds: [], evidenceIds: [] },
        { requirementId: 'R1', status: 'PASS', testCaseIds: [], evidenceIds: [] },
      ];

      const fp1 = computePayloadFingerprint(payload1);
      const fp2 = computePayloadFingerprint(payload2);

      expect(fp1).toBe(fp2);
    });
  });

  describe('computeOutputId', () => {
    it('computes unique output IDs', () => {
      const id1 = computeOutputId('run_001', 'dk_abc');
      const id2 = computeOutputId('run_002', 'dk_abc');

      expect(id1).not.toBe(id2);
    });
  });
});

function makeTestPayload(): CanonicalOutputPayload {
  return {
    schemaVersion: '1.0',
    runId: 'run_001',
    sourceRevision: {
      sourceId: 'src_001',
      revision: 'rev_001',
    },
    requirements: [
      { requirementId: 'R1', status: 'PASS', testCaseIds: ['TC1'], evidenceIds: ['E1'] },
    ],
    testCases: [
      { testCaseId: 'TC1', requirementIds: ['R1'], status: 'PASS', proofOrigin: 'FRESH', evidenceIds: ['E1'] },
    ],
    verificationSummary: {
      totalRequirements: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      error: 0,
      notTested: 0,
      totalTestCases: 1,
      testCasesPassed: 1,
      testCasesFailed: 0,
      testCasesBlocked: 0,
      testCasesSkipped: 0,
    },
    evidenceOrigin: {
      freshEvidenceCount: 1,
      reusedEvidenceCount: 0,
      notTrackedCount: 0,
    },
    safeEvidenceReferences: [],
    traceSummary: { nodes: [], edges: [] },
    warnings: [],
    errors: [],
    timestamps: { projectedAt: '2026-01-01T00:00:00.000Z' },
  };
}

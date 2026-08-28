import { describe, it, expect } from 'vitest';
import { projectToCanonicalPayload, Scenario3Result } from '../src/projection.js';

describe('projection', () => {
  describe('projectToCanonicalPayload', () => {
    it('projects Scenario3Result to CanonicalOutputPayload', () => {
      const result = makeScenario3Result();
      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.schemaVersion).toBe('1.0');
      expect(payload.runId).toBe('run_001');
      expect(payload.sourceRevision.sourceId).toBe('src_001');
      expect(payload.requirements).toHaveLength(1);
      expect(payload.testCases).toHaveLength(1);
    });

    it('extracts source revision from requirements', () => {
      const result = makeScenario3Result();
      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.sourceRevision.sourceId).toBe('src_001');
      expect(payload.sourceRevision.revision).toBe('rev_001');
      expect(payload.sourceRevision.contentHash).toBe('hash_001');
      expect(payload.sourceRevision.revisionFingerprint).toBe('fp_001');
    });

    it('maps requirement statuses correctly', () => {
      const result = makeScenario3Result();
      result.requirementResults = [
        { requirementId: 'R1', status: 'passed', testCaseIds: [], evidenceIds: [] },
        { requirementId: 'R2', status: 'failed', testCaseIds: [], evidenceIds: [] },
        { requirementId: 'R3', status: 'blocked', testCaseIds: [], evidenceIds: [] },
      ];

      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.requirements[0].status).toBe('PASS');
      expect(payload.requirements[1].status).toBe('FAIL');
      expect(payload.requirements[2].status).toBe('BLOCKED');
    });

    it('computes verification summary', () => {
      const result = makeScenario3Result();
      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.verificationSummary.totalRequirements).toBe(1);
      expect(payload.verificationSummary.passed).toBe(1);
      expect(payload.verificationSummary.totalTestCases).toBe(1);
      expect(payload.verificationSummary.testCasesPassed).toBe(1);
    });

    it('extracts evidence references', () => {
      const result = makeScenario3Result();
      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.safeEvidenceReferences).toHaveLength(1);
      expect(payload.safeEvidenceReferences[0].evidenceId).toBe('E1');
      expect(payload.safeEvidenceReferences[0].type).toBe('screenshot');
    });

    it('extracts trace summary', () => {
      const result = makeScenario3Result();
      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.traceSummary.nodes).toHaveLength(2);
      expect(payload.traceSummary.edges).toHaveLength(1);
    });

    it('handles empty result gracefully', () => {
      const result: Scenario3Result = {
        status: 'passed',
        requirementResults: [],
        trace: { nodes: [], edges: [], orphanEvidenceIds: [] },
        warnings: [],
      };

      const payload = projectToCanonicalPayload(result, 'run_001');

      expect(payload.requirements).toHaveLength(0);
      expect(payload.testCases).toHaveLength(0);
      expect(payload.safeEvidenceReferences).toHaveLength(0);
    });
  });
});

function makeScenario3Result(): Scenario3Result {
  return {
    status: 'passed',
    requirements: {
      sourceId: 'src_001',
      revision: 'rev_001',
      contentHash: 'hash_001',
      revisionFingerprint: 'fp_001',
    },
    testPlan: {
      scenarios: [
        {
          id: 'SCN1',
          testCases: [
            { id: 'TC1', requirementIds: ['R1'] },
          ],
        },
      ],
    },
    execution: {
      testResults: [
        {
          testCaseId: 'TC1',
          scenarioId: 'SCN1',
          requirementIds: ['R1'],
          status: 'passed',
          evidence: [
            { id: 'E1', type: 'screenshot', sourceExecutor: 'ui', artifactRef: '/screenshots/e1.png' },
          ],
        },
      ],
      summary: {
        testsTotal: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        skipped: 0,
      },
      evidence: [
        { id: 'E1', type: 'screenshot', sourceExecutor: 'ui', artifactRef: '/screenshots/e1.png' },
      ],
    },
    requirementResults: [
      { requirementId: 'R1', status: 'passed', testCaseIds: ['TC1'], evidenceIds: ['E1'] },
    ],
    trace: {
      nodes: [
        { id: 'src_001', kind: 'source', ref: 'spec.md' },
        { id: 'req_R1', kind: 'requirement', ref: 'R1' },
      ],
      edges: [
        { from: 'src_001', to: 'req_R1', relation: 'defines' },
      ],
      orphanEvidenceIds: [],
    },
    warnings: [],
    metrics: {
      runStartedAt: '2026-01-01T00:00:00.000Z',
      runFinishedAt: '2026-01-01T00:01:00.000Z',
    },
    revisionFingerprint: 'fp_001',
  };
}

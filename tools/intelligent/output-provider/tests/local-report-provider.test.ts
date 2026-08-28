import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalReportProvider } from '../src/providers/local-report.js';
import { CanonicalOutputPayload, OutputDeliveryContext } from '../src/models.js';

describe('LocalReportProvider', () => {
  let tempDir: string;
  let provider: LocalReportProvider;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'local-report-test-'));
    provider = new LocalReportProvider({
      basePath: tempDir,
      format: 'markdown',
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('deliver', () => {
    it('creates markdown report', async () => {
      const payload = makeTestPayload();
      const context = makeTestContext();

      const result = await provider.deliver(payload, context);

      expect(result.success).toBe(true);
      expect(result.status).toBe('DELIVERED');
      expect(result.artifactPath).toBeDefined();

      const content = await readFile(result.artifactPath!, 'utf-8');
      expect(content).toContain('# TIRAI Test Execution Report');
      expect(content).toContain('**Run ID:** run_001');
    });

    it('creates directory structure', async () => {
      const payload = makeTestPayload();
      const context = makeTestContext({ path: 'subdir/report' });

      const result = await provider.deliver(payload, context);

      expect(result.artifactPath).toContain('subdir');
      expect(result.artifactPath).toContain('report');
    });

    it('includes verification summary', async () => {
      const payload = makeTestPayload();
      const context = makeTestContext();

      const result = await provider.deliver(payload, context);

      const content = await readFile(result.artifactPath!, 'utf-8');
      expect(content).toContain('## Verification Summary');
      expect(content).toContain('| Total Requirements | 1 |');
      expect(content).toContain('| Passed | 1 |');
    });

    it('includes evidence origin', async () => {
      const payload = makeTestPayload();
      const context = makeTestContext();

      const result = await provider.deliver(payload, context);

      const content = await readFile(result.artifactPath!, 'utf-8');
      expect(content).toContain('## Evidence Origin');
      expect(content).toContain('- **Fresh Evidence:** 1');
    });

    it('includes trace summary', async () => {
      const payload = makeTestPayload();
      const context = makeTestContext();

      const result = await provider.deliver(payload, context);

      const content = await readFile(result.artifactPath!, 'utf-8');
      expect(content).toContain('## Traceability');
      expect(content).toContain('### Trace Nodes');
    });

    it('handles reused evidence', async () => {
      const payload = makeTestPayload();
      payload.testCases[0].proofOrigin = 'REUSED';
      const context = makeTestContext();

      const result = await provider.deliver(payload, context);

      const content = await readFile(result.artifactPath!, 'utf-8');
      expect(content).toContain('(Reused)');
      expect(content).toContain('- **Proof Origin:** REUSED');
    });
  });

  describe('dry run', () => {
    it('does not write file in dry run mode', async () => {
      const payload = makeTestPayload();
      const context = makeTestContext();
      context.dryRun = true;

      const result = await provider.deliver(payload, context);

      expect(result.success).toBe(true);
      expect(result.status).toBe('SKIPPED');

      try {
        await readFile(result.artifactPath!, 'utf-8');
        throw new Error('File should not exist');
      } catch (error: any) {
        expect(error.code).toBe('ENOENT');
      }
    });
  });

  describe('JSON format', () => {
    it('creates JSON report when format is json', async () => {
      const jsonProvider = new LocalReportProvider({
        basePath: tempDir,
        format: 'json',
      });

      const payload = makeTestPayload();
      const context = makeTestContext();

      const result = await jsonProvider.deliver(payload, context);

      expect(result.success).toBe(true);
      expect(result.artifactPath).toContain('.json');

      const content = await readFile(result.artifactPath!, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.schemaVersion).toBe('1.0');
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
    safeEvidenceReferences: [
      { evidenceId: 'E1', type: 'screenshot', sourceExecutor: 'ui' },
    ],
    traceSummary: {
      nodes: [
        { id: 'src_001', kind: 'source', ref: 'spec.md' },
        { id: 'req_R1', kind: 'requirement', ref: 'R1' },
      ],
      edges: [
        { from: 'src_001', to: 'req_R1', relation: 'defines' },
      ],
    },
    warnings: [],
    errors: [],
    timestamps: { projectedAt: '2026-01-01T00:00:00.000Z' },
  };
}

function makeTestContext(overrides: Partial<OutputDeliveryContext['target']> = {}): OutputDeliveryContext {
  return {
    providerId: 'local-report',
    target: {
      type: 'local-file',
      path: 'test-report',
      format: 'markdown',
      ...overrides,
    },
    deliveryPolicy: 'OVERWRITE_CURRENT',
    dryRun: false,
  };
}

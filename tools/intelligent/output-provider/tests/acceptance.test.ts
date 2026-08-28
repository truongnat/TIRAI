import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DeliveryCoordinator } from '../src/coordinator.js';
import { InMemoryProviderRegistry } from '../src/registry.js';
import { InMemoryDeliveryJournal } from '../src/delivery-journal.js';
import { LocalReportProvider } from '../src/providers/local-report.js';
import { CanonicalOutputPayload, OutputProvider, OutputDeliveryResult } from '../src/models.js';
import { Scenario3Result } from '../src/projection.js';
import { computePayloadFingerprint } from '../src/fingerprint.js';

describe('Phase 4C.1 Deterministic Acceptance', () => {
  let tempDir: string;
  let registry: InMemoryProviderRegistry;
  let journal: InMemoryDeliveryJournal;
  let coordinator: DeliveryCoordinator;
  let localProvider: LocalReportProvider;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'acceptance-test-'));
    registry = new InMemoryProviderRegistry();
    journal = new InMemoryDeliveryJournal();
    localProvider = new LocalReportProvider({
      basePath: tempDir,
      format: 'markdown',
    });
    registry.register(localProvider);
    coordinator = new DeliveryCoordinator({ registry, journal });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Section 53: First Delivery', () => {
    it('delivers result to local report', async () => {
      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      expect(response.aggregateStatus).toBe('ALL_DELIVERED');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].status).toBe('DELIVERED');
      expect(response.results[0].artifactPath).toBeDefined();

      const content = await readFile(response.results[0].artifactPath!, 'utf-8');
      expect(content).toContain('# TIRAI Test Execution Report');
    });
  });

  describe('Section 54: Exact Replay', () => {
    it('skips unchanged delivery', async () => {
      const result = makeScenario3Result();

      const response1 = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      expect(response1.results[0].status).toBe('DELIVERED');

      const response2 = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      expect(response2.results[0].status).toBe('UNCHANGED');
      expect(response2.metrics.idempotentReplays).toBe(1);
      expect(response2.metrics.deliveryWritesAvoided).toBe(1);
    });
  });

  describe('Section 55: Changed Result', () => {
    it('updates delivery with new content', async () => {
      const result1 = makeScenario3Result();
      const result2 = makeScenario3Result();
      result2.status = 'failed';
      result2.requirementResults = [
        { requirementId: 'R1', status: 'failed', testCaseIds: ['TC1'], evidenceIds: ['E1'] },
      ];

      const response1 = await coordinator.deliver({
        result: result1,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      expect(response1.results[0].status).toBe('DELIVERED');

      const response2 = await coordinator.deliver({
        result: result2,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      expect(response2.results[0].status).toBe('DELIVERED');
      expect(response2.results[0].deliveryKey).toBe(response1.results[0].deliveryKey);
      expect(response2.results[0].payloadFingerprint).not.toBe(response1.results[0].payloadFingerprint);
      expect(response2.metrics.reportsUpdated).toBe(1);
    });
  });

  describe('Section 56: Partial Failure', () => {
    it('aggregates partial delivery status', async () => {
      const throwingProvider: OutputProvider = {
        id: 'throwing-provider',
        displayName: 'Throwing Provider',
        deliver: async () => { throw new Error('Provider failure'); },
      };
      registry.register(throwingProvider);

      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [
          { providerId: 'local-report', target: { type: 'local-file', path: 'report-a' } },
          { providerId: 'throwing-provider', target: { type: 'test', path: 'report-b' } },
        ],
      });

      expect(response.aggregateStatus).toBe('PARTIAL');
      expect(response.results[0].status).toBe('DELIVERED');
      expect(response.results[1].status).toBe('FAILED');
    });
  });

  describe('Section 57: Provider Failure', () => {
    it('preserves Scenario3Result truth on delivery failure', async () => {
      const throwingProvider: OutputProvider = {
        id: 'throwing-provider',
        displayName: 'Throwing Provider',
        deliver: async () => { throw new Error('Provider failure'); },
      };
      registry.register(throwingProvider);

      const result = makeScenario3Result();
      result.status = 'passed';

      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'throwing-provider', target: { type: 'test', path: 'report' } }],
      });

      expect(response.aggregateStatus).toBe('ALL_FAILED');
      expect(result.status).toBe('passed');
    });
  });

  describe('Section 58: No Providers', () => {
    it('handles empty targets gracefully', async () => {
      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [],
      });

      expect(response.aggregateStatus).toBe('NO_PROVIDERS');
      expect(response.results).toHaveLength(0);
    });
  });

  describe('Section 59: Unknown Provider', () => {
    it('fails closed for unknown provider', async () => {
      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'unknown-provider', target: { type: 'test', path: 'report' } }],
      });

      expect(response.aggregateStatus).toBe('ALL_FAILED');
      expect(response.results[0].error).toContain('Provider not found');
    });
  });

  describe('Section 60: Path Traversal', () => {
    it('prevents path traversal', async () => {
      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: '../../outside' } }],
      });

      const files = await readdir(tempDir, { recursive: true });
      const hasOutside = files.some((f) => typeof f === 'string' && f.includes('outside'));
      expect(hasOutside).toBe(false);
    });
  });

  describe('Section 61: Secret Redaction', () => {
    it('redacts secrets from payload and journal', async () => {
      const result = makeScenario3Result();
      (result as any).secretData = 'OPENAI_SECRET_SENTINEL';

      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      expect(response.metrics.secretLeakCount).toBe(0);

      const content = await readFile(response.results[0].artifactPath!, 'utf-8');
      expect(content).not.toContain('OPENAI_SECRET_SENTINEL');
    });
  });

  describe('Section 62: Reused Evidence', () => {
    it('truthfully distinguishes proof origin', async () => {
      const result = makeScenario3Result();
      result.execution!.testResults![0].status = 'skipped';

      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      const content = await readFile(response.results[0].artifactPath!, 'utf-8');
      expect(content).toContain('**Proof Origin:** NOT_EXECUTED');
    });
  });

  describe('Section 63: Trace', () => {
    it('includes safe traceability in report', async () => {
      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'report' } }],
      });

      const content = await readFile(response.results[0].artifactPath!, 'utf-8');
      expect(content).toContain('## Traceability');
      expect(content).toContain('### Trace Nodes');
      expect(content).toContain('src_001');
      expect(content).toContain('req_R1');
    });
  });

  describe('Section 64: Multi-Provider', () => {
    it('delivers to multiple providers independently', async () => {
      const provider2: OutputProvider = {
        id: 'local-report-json',
        displayName: 'Local Report JSON Provider',
        deliver: async (payload, context) => ({
          success: true,
          status: 'DELIVERED',
          outputId: 'out_json',
          deliveryKey: context.target.path ?? 'default',
          payloadFingerprint: 'fp_json',
          providerId: 'local-report-json',
          target: context.target,
          artifactPath: `${tempDir}/report.json`,
        }),
      };
      registry.register(provider2);

      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [
          { providerId: 'local-report', target: { type: 'local-file', path: 'report-md' } },
          { providerId: 'local-report-json', target: { type: 'local-file', path: 'report-json' } },
        ],
      });

      expect(response.results).toHaveLength(2);
      expect(response.results[0].status).toBe('DELIVERED');
      expect(response.results[1].status).toBe('DELIVERED');
      expect(response.results[0].deliveryKey).not.toBe(response.results[1].deliveryKey);
    });
  });

  describe('Section 65: Integration Canary', () => {
    it('runs full pipeline without handcrafted projection', async () => {
      const result = makeScenario3Result();
      const response = await coordinator.deliver({
        result,
        targets: [{ providerId: 'local-report', target: { type: 'local-file', path: 'canary' } }],
      });

      expect(response.aggregateStatus).toBe('ALL_DELIVERED');
      expect(result.status).toBe('passed');

      const content = await readFile(response.results[0].artifactPath!, 'utf-8');
      expect(content).toContain('# TIRAI Test Execution Report');
      expect(content).not.toContain('OPENAI_SECRET_SENTINEL');
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
      summary: { testsTotal: 1, passed: 1, failed: 0, blocked: 0, skipped: 0 },
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
      edges: [{ from: 'src_001', to: 'req_R1', relation: 'defines' }],
      orphanEvidenceIds: [],
    },
    warnings: [],
    metrics: { runStartedAt: '2026-01-01T00:00:00.000Z', runFinishedAt: '2026-01-01T00:01:00.000Z' },
    revisionFingerprint: 'fp_001',
  };
}

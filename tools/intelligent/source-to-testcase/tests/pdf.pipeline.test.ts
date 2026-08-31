import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument, rgb } from 'pdf-lib';
import { FakeAIProvider } from 'ai-provider';
import { runSourceToTestCasePipeline } from '../src/pipeline.js';

describe('PDF pipeline', () => {
  it('PDF spec -> TestCase via pipeline (fake)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-pdf-pipeline-'));
    const pdfPath = path.join(tmpDir, 'spec.pdf');
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    page.drawText('Order Validation\nIf quantity > availableStock then INSUFFICIENT_STOCK', { x: 50, y: 300, size: 12, color: rgb(0, 0, 0) });
    fs.writeFileSync(pdfPath, await doc.save());

    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [
        // ChunkSemanticResult
        {
          contextId: 'ctx-0',
          sections: [{ localId: 'sec-1', title: 'Order Validation', provenance: [{ contextId: 'ctx-0' }], confidence: 0.9 }],
          entities: [{ localId: 'ent-1', name: 'Order', type: 'domain', provenance: [{ contextId: 'ctx-0' }], confidence: 0.9 }],
          flows: [],
          rules: [{ localId: 'rule-1', type: 'validation', statement: 'If quantity > availableStock then INSUFFICIENT_STOCK', conditions: [], effects: [], provenance: [{ contextId: 'ctx-0' }], confidence: 0.9 }],
          relationships: [],
          unresolved: [],
        },
        // Consolidation
        { mergeCandidates: [], crossChunkRelationships: [], documentSummary: { title: 'Order Validation', summary: 'Rule', language: ['en'], domainHints: ['order'] } },
        // CandidateExtraction
        {
          candidates: [{
            temporaryId: 'REQ-T-1', title: 'Order validation', type: 'functional', statement: 'If quantity > availableStock then INSUFFICIENT_STOCK',
            sourceNature: 'explicit', semanticEvidenceIds: ['rule-1'], provenance: [{ contextId: 'ctx-0' }], confidence: 0.9,
            preconditions: [], inputs: [{ name: 'quantity', description: 'q', provenance: [{ contextId: 'ctx-0' }] }, { name: 'availableStock', description: 's', provenance: [{ contextId: 'ctx-0' }] }],
            dataNeeds: [], expectedBehaviors: [{ description: 'INSUFFICIENT_STOCK', provenance: [{ contextId: 'ctx-0' }] }], outcomes: [], constraints: [],
          }],
          unresolvedCandidates: [], conflictCandidates: [],
        },
        { duplicateGroups: [], additionalConflicts: [] },
        { coverageCandidates: [{ requirementId: 'REQ-0001', strategies: ['positive'], reasons: ['has constraints'], confidence: 0.9 }], unresolvedCandidates: [] },
        { scenarios: [{ temporaryId: 'SCN-T-1', title: 'Order validation', objective: 'Test', category: 'negative', requirementIds: ['REQ-0001'], preconditions: [], dataNeeds: [], expectedBehavior: ['INSUFFICIENT_STOCK'], priority: 'high', provenance: [{ requirementId: 'REQ-0001', contextId: 'ctx-0' }], confidence: 0.9 }] },
        {
          testCases: [{
            temporaryId: 'TC-T-1', scenarioTemporaryId: 'SCN-T-1', requirementIds: ['REQ-0001'], title: 'Test', objective: 'Test', type: 'api', priority: 'high',
            preconditions: [], inputs: [{ name: 'quantity', valueStrategy: 'fixed', value: 10, description: 'q' }, { name: 'availableStock', valueStrategy: 'fixed', value: 5, description: 's' }],
            dataNeeds: [], steps: [{ order: 1, action: 'Submit', target: 'order' }],
            expectedResults: [{ description: 'INSUFFICIENT_STOCK', verificationType: 'state', verificationIntent: { kind: 'value-equals', expectedValue: 'INSUFFICIENT_STOCK' } }],
            cleanup: [], automation: { status: 'manual-only', reasons: [] }, provenance: [{ requirementId: 'REQ-0001', contextId: 'ctx-0' }], confidence: 0.9,
          }],
          additionalDataNeeds: [], warnings: [],
        },
      ],
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });

    const result = await runSourceToTestCasePipeline({
      sourcePath: pdfPath,
      provider,
      outputDir: path.join(tmpDir, 'output'),
      sourceKind: 'pdf',
    });

    expect(result.source.connectorId).toBe('local-pdf-connector');
    expect(result.testPlanIR.testCases.length).toBeGreaterThan(0);
    expect(result.testPlanIR.testCases[0]!.expectedResults[0]!.verificationIntent.expectedValue).toBe('INSUFFICIENT_STOCK');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 10000);
});

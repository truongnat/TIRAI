// ---------------------------------------------------------------------------
// Builder end-to-end + output tests (spec §74)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildRequirements } from '../src/builder.js';
import { buildFakeProvider, extractionResult, prov, VALID_SEMANTIC_IR_DIR } from './fixtures/helpers.js';
import { REQUIREMENT_PROMPT_VERSION } from '../src/prompts/system.js';
import { computeQualityMetrics } from '../src/quality/metrics.js';
import type { Requirement, RequirementUnresolved, RequirementConflict } from '../src/models.js';

describe('Builder – end-to-end pipeline', () => {
  it('47. produces valid requirement-ir.json', async () => {
    const tmpOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-out-'));
    const provider = buildFakeProvider([
      extractionResult({
        candidates: [
          {
            temporaryId: 'cand-001',
            title: 'Username required',
            type: 'validation',
            statement: 'The system shall require username for login.',
            sourceNature: 'explicit',
            semanticEvidenceIds: ['rule-0001'],
            provenance: [prov('ctx-s000-c000', 'Business Flow')],
            confidence: 0.9,
            preconditions: [],
            inputs: [{ name: 'username', required: true, provenance: [prov('ctx-s000-c000')] }],
            expectedBehaviors: [{ description: 'Check username is not empty', provenance: [prov('ctx-s000-c000')] }],
            outcomes: [],
            constraints: [{ type: 'required', description: 'Username must not be empty', provenance: [prov('ctx-s000-c000')] }],
          },
        ],
        unresolvedCandidates: [],
        conflictCandidates: [],
      }),
    ]);

    const ir = await buildRequirements(VALID_SEMANTIC_IR_DIR, provider, { outputDir: tmpOutput });

    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.requirements.length).toBe(1);
    expect(ir.requirements[0]!.id).toBe('REQ-0001');
    expect(ir.requirements[0]!.type).toBe('validation');
    expect(ir.requirements[0]!.sourceNature).toBe('explicit');

    // Check output files exist
    expect(fs.existsSync(path.join(tmpOutput, 'requirement-ir.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'quality-report.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'analysis', 'candidate-extraction.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'analysis', 'consolidation.json'))).toBe(true);

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('48. manifest has correct stats', async () => {
    const tmpOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-out-'));
    const provider = buildFakeProvider([
      extractionResult({
        candidates: [
          {
            temporaryId: 'cand-001',
            title: 'Test req',
            type: 'functional',
            statement: 'The system shall do something.',
            sourceNature: 'derived',
            semanticEvidenceIds: ['flow-0001'],
            provenance: [prov('ctx-s000-c000')],
            confidence: 0.8,
            preconditions: [],
            inputs: [],
            expectedBehaviors: [{ description: 'Do something', provenance: [prov('ctx-s000-c000')] }],
            outcomes: [],
            constraints: [],
          },
        ],
        unresolvedCandidates: [],
        conflictCandidates: [],
      }),
    ]);

    await buildRequirements(VALID_SEMANTIC_IR_DIR, provider, { outputDir: tmpOutput });

    const manifest = JSON.parse(fs.readFileSync(path.join(tmpOutput, 'manifest.json'), 'utf-8'));
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.promptVersion).toBe(REQUIREMENT_PROMPT_VERSION);
    expect(manifest.stats.requirements).toBe(1);
    expect(manifest.usage.requests).toBeGreaterThan(0);
    expect(manifest.provider.name).toBe('fake');

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('49. quality report is generated', async () => {
    const tmpOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-out-'));
    const provider = buildFakeProvider([
      extractionResult({
        candidates: [
          {
            temporaryId: 'cand-001',
            title: 'Test',
            type: 'functional',
            statement: 'Shall validate input.',
            sourceNature: 'explicit',
            semanticEvidenceIds: ['flow-0001'],
            provenance: [prov('ctx-s000-c000')],
            confidence: 0.9,
            preconditions: [],
            inputs: [],
            expectedBehaviors: [{ description: 'Validate', provenance: [prov('ctx-s000-c000')] }],
            outcomes: [],
            constraints: [],
          },
        ],
        unresolvedCandidates: [],
        conflictCandidates: [],
      }),
    ]);

    const _ir = await buildRequirements(VALID_SEMANTIC_IR_DIR, provider, { outputDir: tmpOutput });

    const qualityReport = JSON.parse(fs.readFileSync(path.join(tmpOutput, 'quality-report.json'), 'utf-8'));
    expect(qualityReport.total).toBe(1);
    expect(qualityReport.explicit).toBe(1);
    expect(qualityReport.provenanceCoverage).toBe(1);

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('50. intermediate analysis files are written', async () => {
    const tmpOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-out-'));
    const provider = buildFakeProvider([
      extractionResult({
        candidates: [{
          temporaryId: 'cand-001',
          title: 'Test',
          type: 'functional',
          statement: 'Shall work.',
          sourceNature: 'derived',
          semanticEvidenceIds: ['flow-0001'],
          provenance: [prov('ctx-s000-c000')],
          confidence: 0.9,
          preconditions: [],
          inputs: [],
          expectedBehaviors: [{ description: 'Work', provenance: [prov('ctx-s000-c000')] }],
          outcomes: [],
          constraints: [],
        }],
        unresolvedCandidates: [],
        conflictCandidates: [],
      }),
    ]);

    await buildRequirements(VALID_SEMANTIC_IR_DIR, provider, { outputDir: tmpOutput });

    const extractionFile = JSON.parse(
      fs.readFileSync(path.join(tmpOutput, 'analysis', 'candidate-extraction.json'), 'utf-8'),
    );
    expect(extractionFile.totalCandidates).toBe(1);
    expect(extractionFile.batches.length).toBeGreaterThan(0);

    fs.rmSync(tmpOutput, { recursive: true });
  });
});

describe('Quality metrics', () => {
  it('51. computes correct metrics', () => {
    const reqs: Requirement[] = [
      {
        id: 'REQ-0001', title: 'A', type: 'functional', statement: 'A',
        sourceNature: 'explicit', preconditions: [], inputs: [],
        expectedBehaviors: [], outcomes: [], constraints: [],
        relatedSemanticIds: [], provenance: [prov('ctx')], confidence: 0.9,
        testability: { status: 'testable', reasons: [] },
      },
      {
        id: 'REQ-0002', title: 'B', type: 'validation', statement: 'B',
        sourceNature: 'derived', preconditions: [], inputs: [],
        expectedBehaviors: [], outcomes: [], constraints: [],
        relatedSemanticIds: [], provenance: [prov('ctx')], confidence: 0.3,
        testability: { status: 'not-testable', reasons: [] },
      },
    ];
    const unresolved: RequirementUnresolved[] = [];
    const conflicts: RequirementConflict[] = [];

    const metrics = computeQualityMetrics(reqs, unresolved, conflicts);
    expect(metrics.total).toBe(2);
    expect(metrics.explicit).toBe(1);
    expect(metrics.derived).toBe(1);
    expect(metrics.testable).toBe(1);
    expect(metrics.notTestable).toBe(1);
    expect(metrics.lowConfidence).toBe(1);
    expect(metrics.provenanceCoverage).toBe(1);
  });
});

describe('Prompt version', () => {
  it('52. prompt version is 1.0', () => {
    expect(REQUIREMENT_PROMPT_VERSION).toBe('1.0');
  });
});

describe('Empty IR handling', () => {
  it('53. empty semantic IR produces empty requirements', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-empty-'));
    const tmpOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-empty-out-'));

    // Write a minimal valid but empty Semantic IR
    fs.writeFileSync(path.join(tmpDir, 'semantic-ir.json'), JSON.stringify({
      schemaVersion: '1.0',
      status: 'complete',
      document: { provenance: [{ contextId: 'ctx-000' }] },
      sections: [],
      entities: [],
      flows: [],
      rules: [],
      relationships: [],
      unresolved: [],
      analysis: { provider: 'fake', model: 'fake', promptVersion: '1.0', chunksAnalyzed: 0, aiRequests: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, warnings: [], consolidationComplete: true, contextsExpected: 0, contextsCompleted: 0 },
    }), 'utf-8');

    const provider = buildFakeProvider([
      extractionResult({ candidates: [], unresolvedCandidates: [], conflictCandidates: [] }),
    ]);

    const ir = await buildRequirements(tmpDir, provider, { outputDir: tmpOutput });
    expect(ir.requirements.length).toBe(0);
    expect(ir.quality.total).toBe(0);

    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(tmpOutput, { recursive: true });
  });
});

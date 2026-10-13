import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeOrderValidationWorkbook, writeStructuredDesignWorkbook } from './acceptance/make-fixture.js';
import { runSourceToTestCasePipeline, SourceToTestCaseError } from '../src/index.js';
import { buildContractIR } from '../src/contract-builder.js';

const OUT = path.resolve(process.cwd(), 'output', 'phase-5-3-source-to-testcase');
const SRC_DIR = path.join(OUT, 'source');
const SRC = path.join(SRC_DIR, 'acceptance.xlsx');
const STRUCTURED_SRC = path.join(SRC_DIR, 'structured-design.xlsx');

beforeAll(async () => {
  fs.mkdirSync(SRC_DIR, { recursive: true });
  await writeOrderValidationWorkbook(SRC);
  await writeStructuredDesignWorkbook(STRUCTURED_SRC);
}, 30000);

describe('Phase 5.3 source-to-testcase acceptance', () => {
  it('compiles a structured design workbook deterministically end-to-end', async () => {
    const outputDir = path.join(OUT, 'structured');
    const result = await runSourceToTestCasePipeline({ sourcePath: STRUCTURED_SRC, outputDir });

    // No embedded AI: every stage ran deterministically or via connectors.
    expect(result.metrics.sourceIngestionAiCalls).toBe(0);
    expect(result.semantic.aiCalls).toBe(0);
    expect(result.requirements.aiCalls).toBe(0);
    expect(result.testPlan.aiCalls).toBe(0);
    expect(result.requirements.requirementCount).toBeGreaterThan(0);
    expect(result.testPlan.testCaseCount).toBeGreaterThan(0);
    expect(result.semanticIR).toBeDefined();

    const importedContract = buildContractIR({
      document: result.document,
      semanticIR: { ...result.semanticIR!, analysis: {} as NonNullable<typeof result.semanticIR>['analysis'] },
      requirementIR: result.requirementIR!,
      testPlanIR: result.testPlanIR!,
    });
    expect(importedContract.metadata.promptVersions).toEqual([]);
    expect(importedContract.metadata).not.toHaveProperty('aiProvider');
    expect(importedContract.metadata).not.toHaveProperty('aiModel');
    expect(result.requirementIR).toBeDefined();
    expect(result.testPlanIR).toBeDefined();

    // Integrity gates.
    expect(result.metrics.secretLeakCount).toBe(0);
    expect(result.metrics.sourceMutations).toBe(0);
    expect(result.metrics.manualArtifactSubstitutions).toBe(0);
    expect(result.metrics.sourceSpecificBranchesAfterIngestion).toBe(0);
    expect(result.semantic.status).toBe('complete');

    // All artifacts persisted by the pipeline (no hand editing).
    for (const f of Object.values(result.artifacts)) {
      expect(fs.existsSync(f), `missing artifact ${f}`).toBe(true);
    }

    for (const stage of ['source_ingestion', 'semantic_analysis', 'requirement_build', 'test_planning']) {
      const checkpoint = JSON.parse(fs.readFileSync(path.join(outputDir, 'checkpoints', `${stage}.json`), 'utf8'));
      expect(checkpoint.status).toBe('completed');
    }

    // Traceability: every test case traces back to a source context chunk.
    const trace = JSON.parse(fs.readFileSync(result.artifacts.trace, 'utf8'));
    expect(trace.links.length).toBe(result.testPlan.testCaseCount);
    for (const link of trace.links) {
      expect(link.sourceContextIds.length).toBeGreaterThan(0);
    }

    // The deterministic compiler is recorded as the provider; there is no model.
    expect(result.semantic.provider).toBe('structured-design-compiler');
    expect(result.semantic.model).toBe('none');

    // Persist the empirically observed metrics for the acceptance report.
    fs.writeFileSync(path.join(outputDir, 'metrics.json'), JSON.stringify({
      source: result.source,
      semantic: result.semantic,
      requirements: result.requirements,
      testPlan: result.testPlan,
      metrics: result.metrics,
    }, null, 2), 'utf8');
  }, 120000);

  it('stops after ingestion for generic specs and awaits host-agent artifacts', async () => {
    const outputDir = path.join(OUT, 'awaiting');
    const result = await runSourceToTestCasePipeline({ sourcePath: SRC, outputDir });

    expect(result.semantic.status).toBe('awaiting-agent');
    expect(result.semantic.provider).toBe('agent-imported');
    expect(result.semantic.model).toBe('none');
    expect(result.semanticIR).toBeUndefined();
    expect(result.requirementIR).toBeUndefined();
    expect(result.testPlanIR).toBeUndefined();
    expect(result.metrics.secretLeakCount).toBe(0);

    // Ingestion artifacts for the host agent exist.
    for (const artifact of ['context', 'aiInput', 'aiRun', 'semanticContextDir', 'rawContextManifest'] as const) {
      expect(fs.existsSync(result.artifacts[artifact]), `missing artifact ${artifact}`).toBe(true);
    }
    // IR artifacts are produced later via `tirai artifact import`.
    for (const artifact of ['semanticIr', 'requirements', 'testPlan', 'testCases', 'contract', 'trace', 'artifactPlan', 'testDesignSummary'] as const) {
      expect(fs.existsSync(result.artifacts[artifact]), `unexpected artifact ${artifact}`).toBe(false);
    }

    for (const stage of ['semantic_analysis', 'requirement_build', 'test_planning']) {
      const checkpoint = JSON.parse(fs.readFileSync(path.join(outputDir, 'checkpoints', `${stage}.json`), 'utf8'));
      expect(checkpoint.status).toBe('awaiting-agent');
      expect(checkpoint.aiCalls).toBe(0);
    }
  }, 120000);

  it('fails closed on an unsupported source (no fabricated downstream)', async () => {
    const bad = path.join(SRC_DIR, 'not-a-source.txt');
    fs.writeFileSync(bad, 'hello', 'utf8');
    await expect(
      runSourceToTestCasePipeline({ sourcePath: bad, outputDir: path.join(OUT, 'neg') }),
    ).rejects.toBeInstanceOf(SourceToTestCaseError);
  }, 30000);
});

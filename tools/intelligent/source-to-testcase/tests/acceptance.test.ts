import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDefaultSourceConnectorRegistry } from 'source-ingestion';
import { writeOrderValidationWorkbook } from './acceptance/make-fixture.js';
import { buildAcceptanceProvider } from './acceptance/make-provider.js';
import { runSourceToTestCasePipeline, SourceToTestCaseError } from '../src/index.js';

const OUT = path.resolve(process.cwd(), 'output', 'phase-5-3-source-to-testcase');
const SRC_DIR = path.join(OUT, 'source');
const SRC = path.join(SRC_DIR, 'acceptance.xlsx');

beforeAll(async () => {
  fs.mkdirSync(SRC_DIR, { recursive: true });
  await writeOrderValidationWorkbook(SRC);
}, 30000);

describe('Phase 5.3 source-to-testcase acceptance', () => {
  it('runs a REAL .xlsx end-to-end into canonical TestCase JSON', async () => {
    // Connector-neutral, read-only pre-inspection to learn chunk ids.
    const registry = createDefaultSourceConnectorRegistry();
    const doc = await registry.open({ kind: 'excel', path: SRC });
    const chunkIds = doc.contexts.map((c) => c.id);
    expect(chunkIds.length).toBeGreaterThan(0);

    const provider = buildAcceptanceProvider(chunkIds);
    const result = await runSourceToTestCasePipeline({ sourcePath: SRC, provider, outputDir: OUT });

    // Stage AI accounting.
    expect(result.metrics.sourceIngestionAiCalls).toBe(0);
    expect(result.semantic.aiCalls).toBeGreaterThan(0);
    expect(result.requirements.requirementCount).toBeGreaterThan(0);
    expect(result.testPlan.testCaseCount).toBeGreaterThan(0);

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

    // Traceability: every test case traces back to a source context chunk.
    const trace = JSON.parse(fs.readFileSync(result.artifacts.trace, 'utf8'));
    expect(trace.links.length).toBe(result.testPlan.testCaseCount);
    for (const link of trace.links) {
      expect(link.sourceContextIds.length).toBeGreaterThan(0);
    }

    // Provider/model recorded (real provider config would appear here).
    expect(result.semantic.provider).toBe('fake');

    // Persist the empirically observed metrics for the acceptance report.
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({
      source: result.source,
      semantic: result.semantic,
      requirements: result.requirements,
      testPlan: result.testPlan,
      metrics: result.metrics,
    }, null, 2), 'utf8');
  }, 120000);

  it('fails closed on an unsupported source (no fabricated downstream)', async () => {
    const bad = path.join(SRC_DIR, 'not-a-source.txt');
    fs.writeFileSync(bad, 'hello', 'utf8');
    const provider = buildAcceptanceProvider(['ctx-x']);
    await expect(
      runSourceToTestCasePipeline({ sourcePath: bad, provider, outputDir: path.join(OUT, 'neg') }),
    ).rejects.toBeInstanceOf(SourceToTestCaseError);
  }, 30000);
});

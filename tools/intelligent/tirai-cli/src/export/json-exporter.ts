// ---------------------------------------------------------------------------
// TIRAI — JSON Exporter
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

export class JSONExporter implements TestOutputExporter {
  readonly format = 'json';

  async export(input: {
    testPlan: TestPlanIR;
    testCases: TestCase[];
    options?: ExportOptions;
  }): Promise<OutputArtifactIR> {
    const { testPlan, testCases, options } = input;
    const outDir = options?.outDir || './outputs/json';
    const testCaseIds = testCases.map((tc) => tc.id);
    const testPlanFingerprint = createHash('sha256').update(JSON.stringify(testPlan)).digest('hex');

    const output = {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      testPlan,
      testCases,
      testCaseIds,
      fingerprint: testPlanFingerprint,
    };

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.json');
    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8');

    return {
      artifactId: 'artifact-json-' + testPlanFingerprint.slice(0, 12),
      format: 'json',
      kind: 'test-case-export',
      path: filePath,
      testPlanFingerprint,
      testCaseIds,
      createdAt: new Date().toISOString(),
      generatorVersion: '1.0.0',
      status: 'created',
    };
  }
}

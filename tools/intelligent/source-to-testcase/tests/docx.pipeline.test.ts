import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { runSourceToTestCasePipeline } from '../src/pipeline.js';

describe('DOCX pipeline', () => {
  it('DOCX spec -> ingestion artifacts, awaiting host agent', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-docx-pipeline-'));
    const docxPath = path.join(tmpDir, 'spec.docx');
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun('Order Validation If quantity > availableStock then INSUFFICIENT_STOCK')] })] }],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(docxPath, buffer);

    const outputDir = path.join(tmpDir, 'output');
    const result = await runSourceToTestCasePipeline({
      sourcePath: docxPath,
      outputDir,
      sourceKind: 'docx',
    });

    expect(result.source.connectorId).toBe('local-docx-connector');
    expect(result.semantic.status).toBe('awaiting-agent');
    expect(result.semantic.aiCalls).toBe(0);
    expect(result.semantic.provider).toBe('agent-imported');
    expect(result.semantic.model).toBe('none');
    expect(result.testPlanIR).toBeUndefined();

    // Raw artifacts exist; IR artifacts are left for `tirai artifact import`.
    expect(fs.existsSync(result.artifacts.aiInput)).toBe(true);
    expect(fs.existsSync(result.artifacts.context)).toBe(true);
    expect(fs.existsSync(result.artifacts.aiRun)).toBe(true);
    expect(fs.existsSync(result.artifacts.semanticContextDir)).toBe(true);
    expect(fs.existsSync(result.artifacts.rawContextManifest)).toBe(true);
    expect(fs.existsSync(result.artifacts.semanticIr)).toBe(false);
    expect(fs.existsSync(result.artifacts.testCases)).toBe(false);
    expect(fs.existsSync(result.artifacts.contract)).toBe(false);

    for (const stage of ['semantic_analysis', 'requirement_build', 'test_planning']) {
      const checkpoint = JSON.parse(fs.readFileSync(path.join(outputDir, 'checkpoints', `${stage}.json`), 'utf8'));
      expect(checkpoint.status).toBe('awaiting-agent');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 10000);
});

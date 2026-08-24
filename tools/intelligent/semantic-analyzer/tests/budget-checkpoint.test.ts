import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FakeAIProvider } from 'ai-provider';
import { assertRequestWithinBudget, DEFAULT_SEMANTIC_BUDGET, DEFAULT_OUTPUT_BUDGET_POLICY, escalateOutputBudget, estimateRequestTokens } from '../src/budget.js';
import { consolidateHierarchically } from '../src/analysis/consolidator.js';
import { analyzeSemanticContext } from '../src/analyzer.js';
import { computeFingerprint, hashSemanticResult } from '../src/fingerprint.js';
import { readIntermediateResult, writeIntermediateResult } from '../src/persistence/writer.js';
import type { ChunkSemanticResult } from '../src/models.js';
import { VALID_CONTEXT_DIR, buildFakeProvider } from './fixtures/helpers.js';

function emptyResult(contextId: string): ChunkSemanticResult {
  return { contextId, sections: [], entities: [], flows: [], rules: [], relationships: [], unresolved: [] };
}

describe('large-workbook request safety', () => {
  it('includes prompt and schema overhead in the input budget', () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'x'.repeat(400) }],
      responseSchema: { type: 'object', properties: { result: { type: 'string' } } },
      maxOutputTokens: 100,
    };
    expect(estimateRequestTokens(request)).toBeGreaterThan(100);
    expect(() => assertRequestWithinBudget(request, { ...DEFAULT_SEMANTIC_BUDGET, maxInputTokensPerRequest: 50 }, { phase: 'test' })).toThrow('SEMANTIC_INPUT_BUDGET_EXCEEDED');
  });

  // §11 / §28 regression: budget escalation is bounded
  it('escalation returns null when already at ceiling', () => {
    const policy = DEFAULT_OUTPUT_BUDGET_POLICY;
    // Ceiling is 4096, max escalation is 1
    expect(policy.maxOutputBudgetCeiling).toBe(4096);
    expect(policy.maxOutputEscalations).toBe(1);
    // At the ceiling, escalation must return null (no further escalation)
    const atCeiling = escalateOutputBudget(4096, policy);
    expect(atCeiling).toBeNull();
  });

  it('escalation from base returns at most one tier then stops', () => {
    const policy = DEFAULT_OUTPUT_BUDGET_POLICY;
    const first = escalateOutputBudget(2048, policy);
    // First escalation goes to next tier (4096)
    expect(first).toBe(4096);
    // Second escalation from 4096 returns null (ceiling reached)
    const second = escalateOutputBudget(4096, policy);
    expect(second).toBeNull();
  });

  it('rejects an output request without a bounded completion', () => {
    expect(() => assertRequestWithinBudget({ messages: [{ role: 'user', content: 'small' }] }, DEFAULT_SEMANTIC_BUDGET, { phase: 'test' })).toThrow('SEMANTIC_OUTPUT_BUDGET_EXCEEDED');
  });

  it('uses deterministic sheet-local and recursive consolidation batches', async () => {
    const results = Array.from({ length: 20 }, (_, i) => emptyResult(`ctx-${String(i).padStart(3, '0')}`));
    const response = { mergeCandidates: [], crossChunkRelationships: [] };
    const provider = new FakeAIProvider({ responses: Array.from({ length: 100 }, () => response), model: 'fake-model' });
    const budget = { ...DEFAULT_SEMANTIC_BUDGET, maxContextsPerBatch: 4, maxConsolidationItemsPerBatch: 4, maxConsolidationInputTokens: 2048, maxInputTokensPerRequest: 2048 };
    const sheetMap = new Map(results.map((result, i) => [result.contextId, i < 10 ? 'Sheet A' : 'Sheet B']));
    const output = await consolidateHierarchically(results, ['Sheet A', 'Sheet B'], provider, budget, sheetMap);
    expect(output.metrics.batchRequests).toBeGreaterThan(1);
    expect(provider.requestLog.every((request) => {
      const out = request.maxOutputTokens ?? 0;
      // Chunk requests use maxOutputTokensPerRequest; consolidation requests use maxConsolidationOutputTokens.
      return out === budget.maxOutputTokensPerRequest || out === budget.maxConsolidationOutputTokens;
    })).toBe(true);
    expect(Math.max(...provider.requestLog.map(estimateRequestTokens))).toBeLessThanOrEqual(budget.maxInputTokensPerRequest);
  });
});

describe('authoritative semantic checkpoints', () => {
  it('invalidates same-ID changed content and reuses unchanged completed work', async () => {
    const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-context-'));
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-output-'));
    try {
      fs.cpSync(VALID_CONTEXT_DIR, contextDir, { recursive: true });
      const firstProvider = buildFakeProvider([emptyResult('ctx-test-000'), emptyResult('ctx-test-001')]);
      await analyzeSemanticContext(contextDir, firstProvider, { outputDir, model: 'model-a' });

      const changedPath = path.join(contextDir, 'chunks', 'ctx-test-000.json');
      const changed = JSON.parse(fs.readFileSync(changedPath, 'utf8')) as { content: string };
      changed.content += '\nsemantic mutation with the same context ID';
      fs.writeFileSync(changedPath, JSON.stringify(changed));

      const changedProvider = buildFakeProvider([emptyResult('ctx-test-000'), emptyResult('ctx-test-001')]);
      await analyzeSemanticContext(contextDir, changedProvider, { outputDir, model: 'model-a', resume: true });
      expect(changedProvider.requestLog.length).toBe(2);

      const unchangedProvider = new FakeAIProvider({ name: 'fake', model: 'model-a' });
      await analyzeSemanticContext(contextDir, unchangedProvider, { outputDir, model: 'model-a', resume: true });
      expect(unchangedProvider.requestLog.length).toBe(0);
    } finally {
      fs.rmSync(contextDir, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('persists and validates the exact fingerprint identity', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-checkpoint-'));
    try {
      const result = emptyResult('ctx-000');
      const fingerprint = computeFingerprint('content-a', 'prompt-1', 'model-a');
      writeIntermediateResult(outputDir, 'ctx-000', result, 'fake', 'model-a', {}, fingerprint, 'prompt-1');
      expect(readIntermediateResult(outputDir, 'ctx-000', fingerprint, 'fake', 'model-a', 'prompt-1')?.result.contextId).toBe('ctx-000');
      expect(readIntermediateResult(outputDir, 'ctx-000', computeFingerprint('content-b', 'prompt-1', 'model-a'), 'fake', 'model-a', 'prompt-1')).toBeNull();
      expect(readIntermediateResult(outputDir, 'ctx-000', fingerprint, 'fake', 'model-b', 'prompt-1')).toBeNull();
      expect(readIntermediateResult(outputDir, 'ctx-000', fingerprint, 'fake', 'model-a', 'prompt-2')).toBeNull();
      const persisted = JSON.parse(fs.readFileSync(path.join(outputDir, 'analysis', 'ctx-000.json'), 'utf8'));
      expect(persisted.fingerprint).toBe(fingerprint);
      expect(persisted.resultHash).toBe(hashSemanticResult(result));
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('fails closed for a legacy intermediate file without a fingerprint', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-legacy-'));
    try {
      const analysisDir = path.join(outputDir, 'analysis');
      fs.mkdirSync(analysisDir);
      fs.writeFileSync(path.join(analysisDir, 'ctx-000.json'), JSON.stringify({ contextId: 'ctx-000', provider: 'fake', model: 'model-a', result: emptyResult('ctx-000'), usage: {} }));
      expect(readIntermediateResult(outputDir, 'ctx-000', 'anything', 'fake', 'model-a', 'prompt-1')).toBeNull();
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps successful chunk checkpoints when a later chunk fails', async () => {
    const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-failure-context-'));
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-failure-output-'));
    try {
      fs.cpSync(VALID_CONTEXT_DIR, contextDir, { recursive: true });
      class FailingProvider extends FakeAIProvider {
        override async generate(request: Parameters<FakeAIProvider['generate']>[0]): Promise<Awaited<ReturnType<FakeAIProvider['generate']>>> {
          const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
          if (user.includes('Context ID: ctx-test-001')) throw new Error('simulated persistent failure');
          return super.generate(request) as Promise<Awaited<ReturnType<FakeAIProvider['generate']>>>;
        }
      }
      const failingProvider = new FailingProvider({ responses: [emptyResult('ctx-test-000')] });
      await expect(analyzeSemanticContext(contextDir, failingProvider, { outputDir, concurrency: 1, model: 'model-a' })).rejects.toThrow('simulated persistent failure');
      expect(fs.existsSync(path.join(outputDir, 'analysis', 'ctx-test-000.json'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'semantic-ir.json'))).toBe(false);
    } finally {
      fs.rmSync(contextDir, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

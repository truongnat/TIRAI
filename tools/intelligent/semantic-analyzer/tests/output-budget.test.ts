// ---------------------------------------------------------------------------
// Adaptive output budget tests — offline with mocked provider
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { AIProviderError, AIProviderErrorCode, FakeAIProvider } from 'ai-provider';
import {
  computeAdaptiveOutputBudget,
  escalateOutputBudget,
  isOutputLimitError,
  DEFAULT_OUTPUT_BUDGET_POLICY,
  DEFAULT_SEMANTIC_BUDGET,
  resolveSemanticBudget,
} from '../src/budget.js';
import { analyzeChunk } from '../src/analysis/chunk-analyzer.js';
import { computeFingerprint } from '../src/fingerprint.js';
import { contextChunk, chunkResult } from './fixtures/helpers.js';
import type { ChunkSemanticResult } from '../src/models.js';

// ---- Adaptive output budget computation -----------------------------------

describe('computeAdaptiveOutputBudget', () => {
  it('returns 2048 for small contexts (<=2000 estimated input tokens)', () => {
    expect(computeAdaptiveOutputBudget(500)).toBe(2048);
    expect(computeAdaptiveOutputBudget(1000)).toBe(2048);
    expect(computeAdaptiveOutputBudget(2000)).toBe(2048);
  });

  it('returns 4096 for large contexts (>2000 estimated input tokens)', () => {
    expect(computeAdaptiveOutputBudget(2001)).toBe(4096);
    expect(computeAdaptiveOutputBudget(5000)).toBe(4096);
    expect(computeAdaptiveOutputBudget(8000)).toBe(4096);
  });

  it('respects custom hard ceiling', () => {
    const policy = { maxOutputBudgetCeiling: 2048, maxOutputEscalations: 1 };
    expect(computeAdaptiveOutputBudget(5000, policy)).toBe(2048);
    expect(computeAdaptiveOutputBudget(100, policy)).toBe(2048);
  });

  it('clamps to hard ceiling when ceiling is below tier', () => {
    const policy = { maxOutputBudgetCeiling: 1024, maxOutputEscalations: 0 };
    expect(computeAdaptiveOutputBudget(5000, policy)).toBe(1024);
  });
});

describe('escalateOutputBudget', () => {
  it('escalates from 2048 to 4096', () => {
    expect(escalateOutputBudget(2048)).toBe(4096);
  });

  it('returns null when already at ceiling (4096)', () => {
    expect(escalateOutputBudget(4096)).toBeNull();
  });

  it('respects custom ceiling', () => {
    const policy = { maxOutputBudgetCeiling: 2048, maxOutputEscalations: 1 };
    expect(escalateOutputBudget(2048, policy)).toBeNull();
  });
});

describe('isOutputLimitError', () => {
  it('returns true for AIProviderError with OUTPUT_LIMIT_EXCEEDED', () => {
    const error = new AIProviderError({
      code: AIProviderErrorCode.OUTPUT_LIMIT_EXCEEDED,
      provider: 'deepseek',
      message: 'Output limit exceeded',
    });
    expect(isOutputLimitError(error)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isOutputLimitError(new Error('generic'))).toBe(false);
    expect(isOutputLimitError(null)).toBe(false);
    expect(isOutputLimitError(undefined)).toBe(false);
    const otherError = new AIProviderError({
      code: AIProviderErrorCode.TIMEOUT,
      provider: 'deepseek',
      message: 'Timeout',
    });
    expect(isOutputLimitError(otherError)).toBe(false);
  });
});

describe('resolveSemanticBudget with output policy', () => {
  it('includes default output budget policy', () => {
    const budget = resolveSemanticBudget();
    expect(budget.outputBudgetPolicy).toEqual(DEFAULT_OUTPUT_BUDGET_POLICY);
  });

  it('clamps base output to hard ceiling', () => {
    const budget = resolveSemanticBudget({
      maxOutputTokensPerRequest: 4096,
      outputBudgetPolicy: { maxOutputBudgetCeiling: 2048, maxOutputEscalations: 1 },
    });
    expect(budget.maxOutputTokensPerRequest).toBe(2048);
  });

  it('rejects invalid policy', () => {
    expect(() => resolveSemanticBudget({
      outputBudgetPolicy: { maxOutputBudgetCeiling: 0, maxOutputEscalations: 1 },
    })).toThrow();
  });
});

// ---- Chunk analysis with output budget escalation -------------------------

function buildOutputLimitProvider(
  failCount: number,
  successResponse: ChunkSemanticResult,
): FakeAIProvider {
  let calls = 0;
  // Create a custom provider that throws OUTPUT_LIMIT_EXCEEDED for the first N calls
  class OutputLimitProvider extends FakeAIProvider {
    override async generate(request: Parameters<FakeAIProvider['generate']>[0]): Promise<Awaited<ReturnType<FakeAIProvider['generate']>>> {
      calls++;
      if (calls <= failCount) {
        throw new AIProviderError({
          code: AIProviderErrorCode.OUTPUT_LIMIT_EXCEEDED,
          provider: this.name,
          message: `Output limit exceeded (call ${calls})`,
        });
      }
      return super.generate(request) as Promise<Awaited<ReturnType<FakeAIProvider['generate']>>>;
    }
  }

  return new OutputLimitProvider({
    name: 'fake',
    model: 'fake-model',
    responses: Array.from({ length: 5 }, () => successResponse),
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}

describe('chunk analysis output budget escalation', () => {
  const chunk = contextChunk({ id: 'ctx-budget-test' });
  const successResult = chunkResult({ contextId: 'ctx-budget-test' });

  it('succeeds with adaptive budget for small context', async () => {
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [successResult],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    const analysis = await analyzeChunk(chunk, provider, DEFAULT_SEMANTIC_BUDGET);
    // The test fixture context is ~1766 tokens → adaptive budget = 2048 (tier ≤2000)
    expect(analysis.metrics.initialOutputBudget).toBe(2048);
    expect(analysis.metrics.outputBudgetEscalations).toBe(0);
    expect(analysis.metrics.finishReason).toBe('stop');
  });

  it('escalates once on OUTPUT_LIMIT_EXCEEDED and succeeds', async () => {
    const provider = buildOutputLimitProvider(1, successResult);
    const analysis = await analyzeChunk(chunk, provider, DEFAULT_SEMANTIC_BUDGET);
    expect(analysis.metrics.outputBudgetEscalations).toBe(1);
    // Test fixture context is ~1766 tokens → initial = 2048, escalated to 4096
    expect(analysis.metrics.initialOutputBudget).toBe(2048);
    expect(analysis.metrics.finalOutputBudget).toBe(4096);
    expect(analysis.metrics.finishReason).toBe('stop');
    expect(analysis.result.contextId).toBe('ctx-budget-test');
  });

  it('fails cleanly after second OUTPUT_LIMIT_EXCEEDED (no second escalation)', async () => {
    const provider = buildOutputLimitProvider(3, successResult);
    await expect(analyzeChunk(chunk, provider, DEFAULT_SEMANTIC_BUDGET)).rejects.toThrow();
  });

  it('does not escalate beyond hard ceiling', async () => {
    const policy = { maxOutputBudgetCeiling: 1024, maxOutputEscalations: 1 };
    const budget = resolveSemanticBudget({ outputBudgetPolicy: policy });
    const provider = buildOutputLimitProvider(1, successResult);
    // With ceiling at 1024, adaptive budget = 1024, escalation returns null → fail
    await expect(analyzeChunk(chunk, provider, budget)).rejects.toThrow('SEMANTIC_OUTPUT_LIMIT_EXCEEDED');
  });

  it('records correct metrics after escalation', async () => {
    const provider = buildOutputLimitProvider(1, successResult);
    const analysis = await analyzeChunk(chunk, provider, DEFAULT_SEMANTIC_BUDGET);
    expect(analysis.metrics.requests).toBeGreaterThanOrEqual(2);
    expect(analysis.metrics.outputBudgetEscalations).toBe(1);
    expect(analysis.warnings?.some((w) => w.code === 'SEMANTIC_OUTPUT_BUDGET_ESCALATION')).toBe(true);
  });
});

// ---- Checkpoint fingerprint includes output budget config -----------------

describe('checkpoint fingerprint with output budget policy', () => {
  it('produces different fingerprints for different output budget policies', () => {
    const fp1 = computeFingerprint('content', '1.1', 'model-a', undefined, undefined, undefined, { maxOutputBudgetCeiling: 2048, maxOutputEscalations: 1 });
    const fp2 = computeFingerprint('content', '1.1', 'model-a', undefined, undefined, undefined, { maxOutputBudgetCeiling: 1024, maxOutputEscalations: 0 });
    expect(fp1).not.toBe(fp2);
  });

  it('produces same fingerprint for same output budget policy', () => {
    const policy = { maxOutputBudgetCeiling: 2048, maxOutputEscalations: 1 };
    const fp1 = computeFingerprint('content', '1.1', 'model-a', undefined, undefined, undefined, policy);
    const fp2 = computeFingerprint('content', '1.1', 'model-a', undefined, undefined, undefined, policy);
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprint when policy is added vs absent', () => {
    const fp1 = computeFingerprint('content', '1.1', 'model-a');
    const fp2 = computeFingerprint('content', '1.1', 'model-a', undefined, undefined, undefined, { maxOutputBudgetCeiling: 2048, maxOutputEscalations: 1 });
    expect(fp1).not.toBe(fp2);
  });
});
